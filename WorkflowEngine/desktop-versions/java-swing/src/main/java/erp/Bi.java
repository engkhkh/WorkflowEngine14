package erp;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Business-intelligence layer: workflow instances -> ERP documents, dashboard KPIs and report tables (port of the portal's erp-data.service.ts).
 *  The stage / module mappings come from dashboard.json, shared by every desktop app. */
public final class Bi {
    private Bi() { }

    static final Map<String, Object> SPEC;
    static {
        Map<String, Object> m = new LinkedHashMap<>();
        try (InputStream in = Bi.class.getResourceAsStream("/dashboard.json")) { m = Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8))); } catch (Exception e) { /* empty spec */ }
        SPEC = m;
    }
    public static List<String> stages() { List<String> l = new ArrayList<>(); for (Object o : Json.arr(SPEC.get("stages"))) l.add(Json.str(o)); return l; }
    public static Map<String, String> moduleColors() { Map<String, String> m = new LinkedHashMap<>(); Json.obj(SPEC.get("modules")).forEach((k, v) -> m.put(k, Json.str(v))); return m; }

    public static final class Doc {
        public String id = "", type = "", module = "", number = "", title = "", party = "", currency = "", branch = "", stage = "", step = "", status = "", by = "";
        public double total; public boolean hasTotal;
        public OffsetDateTime date, completed;
        public double age;
        public Map<String, Object> inst;
    }
    public static final class Kpis { public double salesMonth, purchasesMonth, expensesMonth, receivables, payables, pipeline, committed, inTransit, avgCycleDays, rejectRate; public int openDocs, completedMonth, myApprovals; }
    public static final class Month { public int year, month; public double sales, purchases; }
    public static final class StageCount { public int count; public double value; }
    public static final class Group { public String key; public int count, pending, approved, rejected, ndone; public double days, value; public double avgDays() { return ndone == 0 ? 0 : days / ndone; } }
    public static final class Step { public String step; public double avgHours; public int count; }
    public static final class Party { public String party; public double value; public int count; }

    static OffsetDateTime parse(Object o) {
        String s = Json.str(o);
        if (s.isEmpty()) return null;
        try { return OffsetDateTime.parse(s); } catch (Exception e) { /* try local */ }
        try { return LocalDateTime.parse(s).atOffset(ZoneOffset.UTC); } catch (Exception e) { return null; }
    }
    static OffsetDateTime now() { return OffsetDateTime.now(ZoneOffset.UTC); }
    static boolean inMonth(OffsetDateTime d) { if (d == null) return false; OffsetDateTime n = now(); return d.getMonthValue() == n.getMonthValue() && d.getYear() == n.getYear(); }

    static String outcome(Map<String, Object> i) {
        String st = Json.str(i.get("status"));
        if ("Running".equals(st)) return "pending";
        if ("Terminated".equals(st)) return "canceled";
        Pattern rej = Pattern.compile(Json.str(SPEC.get("rejectActions")), Pattern.CASE_INSENSITIVE);
        for (Object ho : Json.arr(i.get("history"))) {
            Map<String, Object> h = Json.obj(ho);
            String a = Json.str(h.get("action"));
            if (rej.matcher(a).find() || ("Entered".equals(a) && Json.str(h.get("nodeName")).toLowerCase().contains("reject"))) return "rejected";
        }
        return "approved";
    }

    static String stageForNode(String n) {
        if (n == null || n.isEmpty()) return "request";
        Map<String, Object> m = Json.obj(SPEC.get("nodeStage"));
        if (m.containsKey(n)) return Json.str(m.get(n));
        String low = n.toLowerCase();
        for (Object ko : Json.arr(SPEC.get("stageKeywords"))) { List<Object> k = Json.arr(ko); if (Pattern.compile(Json.str(k.get(1))).matcher(low).find()) return Json.str(k.get(0)); }
        return "request";
    }

    static String moduleFor(String wf) {
        for (Object d : Json.arr(SPEC.get("docTypes"))) if (Json.str(Json.obj(d).get("workflow")).equals(wf)) return Json.str(Json.obj(d).get("module"));
        String low = wf.toLowerCase();
        for (Object ko : Json.arr(SPEC.get("moduleKeywords"))) { List<Object> k = Json.arr(ko); if (Pattern.compile(Json.str(k.get(1))).matcher(low).find()) return Json.str(k.get(0)); }
        return "operations";
    }

    static Doc toDoc(Map<String, Object> i) {
        Doc d = new Doc();
        Map<String, Object> data = Json.obj(i.get("data"));
        Map<String, Object> dt = null;
        for (Object o : Json.arr(SPEC.get("docTypes"))) if (Json.str(Json.obj(o).get("key")).equals(Json.str(data.get("docType")))) { dt = Json.obj(o); break; }
        if (dt == null) for (Object o : Json.arr(SPEC.get("docTypes"))) if (Json.str(Json.obj(o).get("workflow")).equals(Json.str(i.get("definitionName")))) { dt = Json.obj(o); break; }
        d.type = dt == null ? "" : Json.str(dt.get("key"));
        d.module = dt == null ? moduleFor(Json.str(i.get("definitionName"))) : Json.str(dt.get("module"));
        d.status = outcome(i);
        List<Object> hist = Json.arr(i.get("history"));
        String last = null;
        Pattern skip = Pattern.compile("^(start|end|completed|rejected)$", Pattern.CASE_INSENSITIVE);
        for (int k = hist.size() - 1; k >= 0; k--) {
            Map<String, Object> e = Json.obj(hist.get(k));
            if ("Entered".equals(Json.str(e.get("action"))) && !skip.matcher(Json.str(e.get("nodeName"))).find()) { last = Json.str(e.get("nodeName")); break; }
        }
        if (d.status.equals("approved")) { d.stage = "reporting"; d.step = "Completed"; }
        else if (d.status.equals("pending")) { d.stage = stageForNode(last); d.step = last == null ? "Start" : last; }
        else { d.stage = stageForNode(last); d.step = d.status.equals("rejected") ? "Rejected" : "Canceled"; }
        d.id = Json.str(i.get("id")); d.inst = i; d.title = Json.str(i.get("definitionName"));
        String dn = Json.str(data.get("docNumber"));
        d.number = dn.isEmpty() ? "WF-" + d.id.substring(0, Math.min(6, d.id.length())).toUpperCase() : dn;
        for (String k : new String[]{"party", "employeeName", "candidateName"}) if (d.party.isEmpty()) d.party = Json.str(data.get(k));
        Object tv = data.get("total");
        if (tv instanceof Number) { d.total = ((Number) tv).doubleValue(); d.hasTotal = true; }
        else if (tv instanceof String && !((String) tv).isEmpty()) { try { d.total = Double.parseDouble((String) tv); d.hasTotal = true; } catch (NumberFormatException e) { /* no value */ } }
        d.currency = Json.str(data.get("currency")); d.branch = Json.str(data.get("branch")); d.by = Json.str(i.get("startedBy"));
        d.date = parse(i.get("startedAt")); if (d.date == null) d.date = now();
        d.completed = parse(i.get("completedAt"));
        d.age = Math.max(0, Duration.between(d.date, d.completed != null ? d.completed : now()).toMillis() / 86_400_000.0);
        return d;
    }

    public static List<Doc> docsOf(List<Map<String, Object>> instances) {
        List<Doc> out = new ArrayList<>();
        for (Map<String, Object> i : instances) out.add(toDoc(i));
        out.sort(Comparator.comparing((Doc d) -> d.date).reversed());
        return out;
    }

    public static Kpis kpis(List<Doc> docs, int myTasks) {
        Kpis k = new Kpis(); k.myApprovals = myTasks;
        int done = 0, closed = 0, rejected = 0; double days = 0;
        for (Doc d : docs) {
            boolean pend = d.status.equals("pending"), appr = d.status.equals("approved");
            if (appr && inMonth(d.completed)) {
                if (d.type.equals("SO")) k.salesMonth += d.total;
                if (d.type.equals("PR")) k.purchasesMonth += d.total;
                if (d.type.equals("EXP") || d.type.equals("PV")) k.expensesMonth += d.total;
                k.completedMonth++;
            }
            if (pend) {
                k.openDocs++;
                if (d.type.equals("SO")) { k.pipeline += d.total; if (d.stage.equals("accounting")) k.receivables += d.total; }
                if (d.stage.equals("accounting") && (d.type.equals("PR") || d.type.equals("PV") || d.type.equals("EXP"))) k.payables += d.total;
                if (d.type.equals("PR") && (d.stage.equals("purchase") || d.stage.equals("inventory"))) k.committed += d.total;
                if (d.type.equals("TRF") && d.stage.equals("inventory")) k.inTransit += d.total;
            }
            if (appr) { done++; days += d.age; }
            if (appr || d.status.equals("rejected")) closed++;
            if (d.status.equals("rejected")) rejected++;
        }
        k.avgCycleDays = done > 0 ? days / done : 0; k.rejectRate = closed > 0 ? (double) rejected / closed : 0;
        return k;
    }

    public static List<Month> monthlyTrend(List<Doc> docs, int months) {
        List<Month> out = new ArrayList<>();
        LocalDate n = now().toLocalDate().withDayOfMonth(1);
        for (int k = months - 1; k >= 0; k--) { LocalDate d = n.minusMonths(k); Month m = new Month(); m.year = d.getYear(); m.month = d.getMonthValue(); out.add(m); }
        for (Doc d : docs) {
            if (!d.status.equals("approved") || d.completed == null || !d.hasTotal) continue;
            for (Month m : out) if (m.year == d.completed.getYear() && m.month == d.completed.getMonthValue()) { if (d.type.equals("SO")) m.sales += d.total; if (d.type.equals("PR")) m.purchases += d.total; }
        }
        return out;
    }

    public static Map<String, StageCount> stageCounts(List<Doc> docs) {
        Map<String, StageCount> r = new LinkedHashMap<>();
        for (String s : stages()) r.put(s, new StageCount());
        LocalDate n = now().toLocalDate(); StageCount raised = new StageCount();
        for (Doc d : docs) {
            if (d.status.equals("pending") || d.status.equals("approved")) { StageCount c = r.get(d.status.equals("pending") ? d.stage : "reporting"); if (c != null) { c.count++; c.value += d.total; } }
            if (d.date.getMonthValue() == n.getMonthValue() && d.date.getYear() == n.getYear()) { raised.count++; raised.value += d.total; }
        }
        r.put("request", raised);
        return r;
    }

    public static List<Step> stepTurnaround(List<Doc> docs) {
        Map<String, double[]> acc = new LinkedHashMap<>();
        for (Doc d : docs) {
            List<Object> h = Json.arr(d.inst.get("history"));
            for (int k = 0; k < h.size(); k++) {
                Map<String, Object> e = Json.obj(h.get(k));
                if (!"Entered".equals(Json.str(e.get("action")))) continue;
                for (int j = k + 1; j < h.size(); j++) {
                    Map<String, Object> x = Json.obj(h.get(j)); String a = Json.str(x.get("action"));
                    if (!Json.str(x.get("nodeId")).equals(Json.str(e.get("nodeId"))) || a.equals("Entered") || a.equals("Logged") || "system".equals(Json.str(x.get("actor")))) continue;
                    OffsetDateTime t0 = parse(e.get("timestamp")), t1 = parse(x.get("timestamp"));
                    if (t0 != null && t1 != null) { double[] v = acc.computeIfAbsent(Json.str(e.get("nodeName")), q -> new double[2]); v[0] += Duration.between(t0, t1).toMillis() / 3_600_000.0; v[1]++; }
                    break;
                }
            }
        }
        List<Step> out = new ArrayList<>();
        acc.forEach((k, v) -> { Step s = new Step(); s.step = k; s.avgHours = v[0] / v[1]; s.count = (int) v[1]; out.add(s); });
        out.sort((a, b) -> Double.compare(b.avgHours, a.avgHours));
        return out;
    }

    public static List<Party> topParties(List<Doc> docs, List<String> types, int limit) {
        Map<String, Party> m = new LinkedHashMap<>();
        for (Doc d : docs) {
            if (!types.contains(d.type) || d.party.isEmpty() || d.status.equals("canceled") || d.status.equals("rejected")) continue;
            Party p = m.computeIfAbsent(d.party, q -> { Party x = new Party(); x.party = q; return x; }); p.value += d.total; p.count++;
        }
        List<Party> out = new ArrayList<>(m.values());
        out.sort((a, b) -> Double.compare(b.value, a.value));
        return out.subList(0, Math.min(limit, out.size()));
    }

    public static List<Group> groupBy(List<Doc> docs, boolean byModule) {
        Map<String, Group> g = new LinkedHashMap<>();
        for (Doc d : docs) {
            String k = byModule ? d.module : d.branch; if (k.isEmpty()) k = "—";
            Group r = g.computeIfAbsent(k, q -> { Group x = new Group(); x.key = q; return x; }); r.count++; r.value += d.total;
            switch (d.status) { case "pending": r.pending++; break; case "approved": r.approved++; r.days += d.age; r.ndone++; break; case "rejected": r.rejected++; break; default: }
        }
        List<Group> out = new ArrayList<>(g.values());
        out.sort((a, b) -> Integer.compare(b.count, a.count));
        return out;
    }

    public static List<Object[]> bottleneck(List<Doc> docs) {
        Map<String, Integer> m = new LinkedHashMap<>();
        for (Doc d : docs) if (d.status.equals("pending")) m.merge(d.step, 1, Integer::sum);
        List<Object[]> out = new ArrayList<>();
        m.forEach((k, v) -> out.add(new Object[]{k, v}));
        out.sort((a, b) -> Integer.compare((Integer) b[1], (Integer) a[1]));
        return out;
    }

    public static String money(double v, String cur) { return String.format(java.util.Locale.ENGLISH, "%,d", Math.round(v)) + (cur == null || cur.isEmpty() ? "" : " " + cur); }
    public static String money(double v) { return money(v, ""); }
}
