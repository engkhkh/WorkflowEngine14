package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.GridLayout;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.IntConsumer;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;

/** Dashboard (KPIs, six-stage flow, trend, queue, recent documents) and Reports &amp; Analytics, computed client-side from the workflow instances
 *  exactly like the portal does (see Bi). */
public final class Dashboard {
    private Dashboard() { }

    static final String[] DOC_KEYS = {"col.number", "col.type", "col.party", "col.date", "col.amount", "col.stage", "col.status", "col.step"};

    static String[] docHeaders() { String[] h = new String[DOC_KEYS.length]; for (int i = 0; i < h.length; i++) h[i] = t(DOC_KEYS[i]); return h; }

    static List<String[]> docRows(List<Bi.Doc> docs) {
        List<String[]> out = new ArrayList<>();
        for (Bi.Doc d : docs) {
            String st = d.status.equals("pending") ? t("filter.pending") : d.status.equals("approved") ? t("filter.approved") : t("filter.rejected");
            out.add(new String[]{d.number, d.type.isEmpty() ? d.title : t("doc." + d.type), d.party, d.date.toLocalDate().toString(), d.hasTotal ? Bi.money(d.total) : "", t("stage." + d.stage), st, d.step});
        }
        return out;
    }

    static String curOf(List<Bi.Doc> docs) { for (Bi.Doc d : docs) if (!d.currency.isEmpty()) return d.currency; return ""; }

    static JPanel card(String title, Component body, Component extra) {
        JPanel p = new JPanel(new BorderLayout(0, 6));
        p.setBackground(Color.WHITE);
        p.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(0xE2, 0xE8, 0xF0)), BorderFactory.createEmptyBorder(8, 12, 10, 12)));
        JPanel h = new JPanel(new BorderLayout()); h.setOpaque(false); h.add(titleLabel(title));
        if (extra != null) h.add(extra, BorderLayout.EAST);
        p.add(h, BorderLayout.NORTH); p.add(body);
        p.setAlignmentX(Component.LEFT_ALIGNMENT);
        return p;
    }
    static JLabel titleLabel(String s) { JLabel l = new JLabel(s); l.setFont(l.getFont().deriveFont(java.awt.Font.BOLD, 15f)); return l; }

    static JPanel two(Component a, Component b, double wa) {
        JPanel p = new JPanel(new java.awt.GridBagLayout()); p.setOpaque(false); p.setAlignmentX(Component.LEFT_ALIGNMENT);
        java.awt.GridBagConstraints c = new java.awt.GridBagConstraints(); c.fill = java.awt.GridBagConstraints.BOTH; c.weighty = 1; c.insets = new java.awt.Insets(0, 0, 0, 12);
        c.weightx = wa; p.add(a, c); c.weightx = 1 - wa; c.insets = new java.awt.Insets(0, 0, 0, 0); p.add(b, c);
        return p;
    }

    static JPanel body() {
        JPanel b = new JPanel(); b.setLayout(new BoxLayout(b, BoxLayout.Y_AXIS)); b.setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20)); return b;
    }
    static void gap(JPanel b) { b.add(Box.createVerticalStrut(12)); }

    // ---------------------------------------------------------------- dashboard
    public static final class DashboardPanel extends JPanel implements Reloadable {
        private final JLabel hello = Ui.label("", "title");
        private final Map<String, Charts.KpiCard> k = new LinkedHashMap<>();
        private final Charts.FlowStrip flow;
        public final Ui.DataTable stageTbl = new Ui.DataTable(docHeaders()), queue = new Ui.DataTable(t("col.step"), t("col.number"), t("col.party"), t("col.priority")), recent = new Ui.DataTable(docHeaders());
        private final JScrollPane stageScroll = new JScrollPane(stageTbl);
        private final Charts.TrendChart trend = new Charts.TrendChart(t("module.sales"), t("chart.purchases"));
        private final Charts.HBars mods = new Charts.HBars();
        private List<Bi.Doc> docs = new ArrayList<>();
        private String stage = "";

        public DashboardPanel(IntConsumer go, java.util.function.BiConsumer<String, String> openKind) {
            super(new BorderLayout());
            JPanel b = body();
            JPanel top = new JPanel(new BorderLayout()); top.setOpaque(false); top.add(hello); top.add(Ui.button(t("common.refresh"), this::reload, "ghost"), BorderLayout.EAST); top.setAlignmentX(Component.LEFT_ALIGNMENT);
            b.add(top); gap(b);
            JPanel grid = new JPanel(new GridLayout(2, 3, 10, 10)); grid.setOpaque(false); grid.setAlignmentX(Component.LEFT_ALIGNMENT); grid.setMaximumSize(new Dimension(Integer.MAX_VALUE, 190));
            Object[][] specs = {{"kpi.sales", "#0EA5E9", 4}, {"kpi.purchases", "#8B5CF6", 4}, {"kpi.receivables", "#10B981", 4}, {"kpi.payables", "#F59E0B", 4}, {"kpi.myApprovals", "#EF4444", 1}, {"kpi.cycle", "#64748B", 3}};
            for (Object[] s : specs) { int pg = (Integer) s[2]; Charts.KpiCard c = new Charts.KpiCard(t((String) s[0]), Color.decode((String) s[1]), () -> go.accept(pg)); k.put((String) s[0], c); grid.add(c); }
            b.add(grid); gap(b);
            flow = new Charts.FlowStrip(this::pickStage);
            stageScroll.setPreferredSize(new Dimension(300, 170)); stageScroll.setVisible(false);
            JPanel fw = new JPanel(new BorderLayout(0, 6)); fw.setOpaque(false);
            fw.add(Ui.label(t("dash.flowSub"), "dim"), BorderLayout.NORTH); fw.add(flow); fw.add(stageScroll, BorderLayout.SOUTH);
            b.add(card(t("dash.flow"), fw, null)); gap(b);
            b.add(two(card(t("dash.trend"), trend, null), card(t("dash.byModule"), mods, null), 0.6)); gap(b);
            JScrollPane qs = new JScrollPane(queue); qs.setPreferredSize(new Dimension(300, 140));
            JScrollPane rs = new JScrollPane(recent); rs.setPreferredSize(new Dimension(300, 230));
            b.add(card(t("dash.myQueue"), qs, Ui.button(t("dash.viewAll"), () -> go.accept(1), "ghost"))); gap(b);
            b.add(card(t("dash.recent"), rs, Ui.button(t("dash.viewAll"), () -> go.accept(2), "ghost"))); gap(b);
            JLabel mt = Ui.label(t("home.modules"), "title"); mt.setAlignmentX(Component.LEFT_ALIGNMENT); b.add(mt);
            JPanel mg = new JPanel(new GridLayout(0, 4, 8, 8)); mg.setOpaque(false); mg.setAlignmentX(Component.LEFT_ALIGNMENT);
            for (Map<String, Object> m : I18n.visibleModules()) mg.add(Ui.button(I18n.name(m), () -> openKind.accept(Json.str(m.get("id")), null), "ghost"));
            b.add(mg);
            add(new JScrollPane(b, JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED, JScrollPane.HORIZONTAL_SCROLLBAR_NEVER), BorderLayout.CENTER);
            recent.onOpen(() -> go.accept(2));
        }

        @Override public void reload() {
            hello.setText("<html>" + t("dash.hello") + ", " + Api.I.displayName + "</html>");
            Ui.async(() -> { List<Map<String, Object>> i = safe(Api.I::instances), tk = safe(Api.I::tasks); return new Object[]{i, tk}; }, r -> {
                @SuppressWarnings("unchecked") List<Map<String, Object>> i = (List<Map<String, Object>>) r[0], tk = (List<Map<String, Object>>) r[1];
                fill(i, tk);
            }, e -> { });
        }

        static List<Map<String, Object>> safe(java.util.function.Supplier<List<Map<String, Object>>> s) { try { return s.get(); } catch (RuntimeException e) { return new ArrayList<>(); } }

        public void fill(List<Map<String, Object>> instances, List<Map<String, Object>> tasks) {
            docs = Bi.docsOf(instances);
            Bi.Kpis K = Bi.kpis(docs, tasks.size());
            String c = curOf(docs);
            k.get("kpi.sales").set(Bi.money(K.salesMonth, c), t("kpi.pipeline") + ": " + Bi.money(K.pipeline, c));
            k.get("kpi.purchases").set(Bi.money(K.purchasesMonth, c), t("kpi.committed") + ": " + Bi.money(K.committed, c));
            k.get("kpi.receivables").set(Bi.money(K.receivables, c), "");
            k.get("kpi.payables").set(Bi.money(K.payables, c), t("kpi.expenses") + ": " + Bi.money(K.expensesMonth, c));
            k.get("kpi.myApprovals").set(String.valueOf(K.myApprovals), "");
            k.get("kpi.cycle").set(String.format(java.util.Locale.ENGLISH, "%.1f %s", K.avgCycleDays, t("kpi.days")), t("kpi.openDocs") + ": " + K.openDocs + " · " + t("kpi.rejectRate") + ": " + Math.round(K.rejectRate * 100) + "%");
            Map<String, Bi.StageCount> sc = Bi.stageCounts(docs);
            List<Charts.FlowItem> fi = new ArrayList<>();
            for (String s : Bi.stages()) fi.add(new Charts.FlowItem(s, t("stage." + s), Bi.money(sc.get(s).value), sc.get(s).count));
            flow.set(fi);
            trend.set(Bi.monthlyTrend(docs, 6));
            List<Charts.BarRow> mr = new ArrayList<>();
            Bi.moduleColors().forEach((mk, col) -> { int n = 0; for (Bi.Doc d : docs) if (d.status.equals("pending") && d.module.equals(mk)) n++; if (n > 0) mr.add(new Charts.BarRow(t("module." + mk), n, col, String.valueOf(n))); });
            mr.sort((a, b) -> Double.compare(b.value, a.value));
            mods.set(mr);
            Map<String, Bi.Doc> byId = new LinkedHashMap<>(); for (Bi.Doc d : docs) byId.put(d.id, d);
            List<String[]> qr = new ArrayList<>(); List<Object> qp = new ArrayList<>();
            for (int i = 0; i < Math.min(6, tasks.size()); i++) {
                Map<String, Object> tk = tasks.get(i); Bi.Doc d = byId.get(Json.str(tk.get("instanceId")));
                qr.add(new String[]{Json.str(tk.get("nodeName")), d == null ? "" : d.number, d == null ? "" : d.party, Json.str(tk.get("priority")).isEmpty() ? "Normal" : Json.str(tk.get("priority"))}); qp.add(tk);
            }
            queue.fill(qr, qp);
            List<Bi.Doc> top = docs.subList(0, Math.min(8, docs.size()));
            recent.fill(docRows(top), new ArrayList<Object>(top));
            pickStage(stage);
        }

        public void pickStage(String s) {
            stage = s;
            if (s.isEmpty()) { stageScroll.setVisible(false); revalidate(); return; }
            List<Bi.Doc> sel = new ArrayList<>();
            for (Bi.Doc d : docs) if (s.equals("reporting") ? d.status.equals("approved") : (d.status.equals("pending") && d.stage.equals(s))) sel.add(d);
            if (sel.size() > 50) sel = sel.subList(0, 50);
            stageTbl.fill(docRows(sel), new ArrayList<Object>(sel));
            stageScroll.setVisible(true); revalidate();
        }
        public Charts.FlowStrip flowForTest() { return flow; }
        public Charts.KpiCard kpi(String key) { return k.get(key); }
    }

    // ---------------------------------------------------------------- reports
    public static final class ReportsPanel extends JPanel implements Reloadable {
        private List<Bi.Doc> docs = new ArrayList<>();
        public List<String[]> modRows = new ArrayList<>(), brRows = new ArrayList<>();
        public final Ui.DataTable tMod, tBr;
        private final Charts.HBars bott = new Charts.HBars(), turn = new Charts.HBars(), cust = new Charts.HBars(), vend = new Charts.HBars();

        public ReportsPanel() {
            super(new BorderLayout());
            JPanel b = body();
            JPanel top = new JPanel(new BorderLayout()); top.setOpaque(false); top.setAlignmentX(Component.LEFT_ALIGNMENT);
            top.add(Ui.label(t("rep.title"), "title"));
            top.add(Ui.row(Ui.button(t("common.refresh"), this::reload, "ghost"), Ui.button("🖨 " + t("collab.rep.print"), this::designer, "ghost"), Ui.button(t("rep.export"), this::exportCsv, null)), BorderLayout.EAST);
            b.add(top);
            JLabel sub = Ui.label(t("rep.sub"), "dim"); sub.setAlignmentX(Component.LEFT_ALIGNMENT); b.add(sub); gap(b);
            String[] hd = {t("col.module"), t("col.count"), t("filter.pending"), t("filter.approved"), t("filter.rejected"), t("col.avgDays"), t("col.value")};
            String[] hb = hd.clone(); hb[0] = t("col.branch");
            tMod = new Ui.DataTable(hd); tBr = new Ui.DataTable(hb);
            JScrollPane s1 = new JScrollPane(tMod), s2 = new JScrollPane(tBr); s1.setPreferredSize(new Dimension(300, 170)); s2.setPreferredSize(new Dimension(300, 120));
            b.add(card(t("rep.byModule"), s1, null)); gap(b); b.add(card(t("rep.byBranch"), s2, null)); gap(b);
            b.add(two(card(t("rep.bottleneck"), bott, null), card(t("rep.turnaround"), turn, null), 0.5)); gap(b);
            b.add(two(card(t("rep.topParties") + " · " + t("party.customer"), cust, null), card(t("rep.topParties") + " · " + t("party.vendor"), vend, null), 0.5));
            add(new JScrollPane(b, JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED, JScrollPane.HORIZONTAL_SCROLLBAR_NEVER), BorderLayout.CENTER);
        }

        @Override public void reload() { Ui.async(() -> DashboardPanel.safe(Api.I::instances), this::fill, e -> { }); }

        List<String[]> groupRows(boolean byModule) {
            List<String[]> out = new ArrayList<>();
            for (Bi.Group g : Bi.groupBy(docs, byModule))
                out.add(new String[]{byModule ? t("module." + g.key) : g.key, String.valueOf(g.count), String.valueOf(g.pending), String.valueOf(g.approved), String.valueOf(g.rejected), String.format(java.util.Locale.ENGLISH, "%.1f", g.avgDays()), Bi.money(g.value)});
            return out;
        }

        public void fill(List<Map<String, Object>> instances) {
            docs = Bi.docsOf(instances);
            modRows = groupRows(true); brRows = groupRows(false);
            tMod.fill(modRows, new ArrayList<Object>(java.util.Collections.nCopies(modRows.size(), null))); tBr.fill(brRows, new ArrayList<Object>(java.util.Collections.nCopies(brRows.size(), null)));
            List<Charts.BarRow> b = new ArrayList<>();
            for (Object[] p : Bi.bottleneck(docs).subList(0, Math.min(8, Bi.bottleneck(docs).size()))) b.add(new Charts.BarRow((String) p[0], (Integer) p[1], "#F59E0B", String.valueOf(p[1])));
            bott.set(b);
            List<Charts.BarRow> u = new ArrayList<>(); List<Bi.Step> st = Bi.stepTurnaround(docs);
            for (Bi.Step s : st.subList(0, Math.min(8, st.size()))) u.add(new Charts.BarRow(s.step, s.avgHours, s.avgHours > 24 ? "#DC2626" : "#10B981", String.format(java.util.Locale.ENGLISH, "%.1f %s", s.avgHours, t("rep.hours"))));
            turn.set(u);
            List<Charts.BarRow> c = new ArrayList<>(), v = new ArrayList<>();
            for (Bi.Party p : Bi.topParties(docs, List.of("SO"), 5)) c.add(new Charts.BarRow(p.party, p.value, "#0EA5E9", Bi.money(p.value)));
            for (Bi.Party p : Bi.topParties(docs, List.of("PR", "PV"), 5)) v.add(new Charts.BarRow(p.party, p.value, "#8B5CF6", Bi.money(p.value)));
            cust.set(c); vend.set(v);
        }

        static String csvLine(String... cells) { StringBuilder s = new StringBuilder(); for (int i = 0; i < cells.length; i++) { if (i > 0) s.append(','); s.append('"').append(cells[i].replace("\"", "\"\"")).append('"'); } return s.append("\r\n").toString(); }

        public String csv() {
            StringBuilder s = new StringBuilder(csvLine(t("rep.byModule")));
            s.append(csvLine(t("col.module"), t("col.count"), t("filter.pending"), t("filter.approved"), t("filter.rejected"), t("col.avgDays"), t("col.value")));
            for (String[] r : modRows) s.append(csvLine(r));
            s.append("\r\n").append(csvLine(t("rep.byBranch")));
            for (String[] r : brRows) s.append(csvLine(r));
            s.append("\r\n").append(csvLine(t("rep.turnaround")));
            for (Bi.Step st : Bi.stepTurnaround(docs)) s.append(csvLine(st.step, String.format(java.util.Locale.ENGLISH, "%.1f", st.avgHours), String.valueOf(st.count)));
            return s.toString();
        }

        void exportCsv() {
            JFileChooser fc = new JFileChooser(); fc.setSelectedFile(new java.io.File("report.csv"));
            if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
            try { Files.writeString(Path.of(fc.getSelectedFile().getPath()), "﻿" + csv(), StandardCharsets.UTF_8); } catch (IOException e) { Ui.warn(this, e.getMessage()); }
        }

        void designer() {
            String[] keys = {"number", "type", "party", "date", "amount", "stage", "status", "step"};
            List<Report.Column> cols = new ArrayList<>();
            for (int i = 0; i < keys.length; i++) cols.add(new Report.Column(keys[i], t(DOC_KEYS[i]), i == 4));
            List<Map<String, String>> rows = new ArrayList<>(); List<String[]> dr = docRows(docs);
            for (int r = 0; r < dr.size(); r++) { Map<String, String> row = new LinkedHashMap<>(); for (int i = 0; i < keys.length; i++) row.put(keys[i], dr.get(r)[i]); row.put("amount#", String.valueOf(docs.get(r).total)); rows.add(row); }
            new Report.Dialog(this, "reports:documents", t("rep.title"), cols, rows, Api.I.displayName).setVisible(true);
        }
    }
}
