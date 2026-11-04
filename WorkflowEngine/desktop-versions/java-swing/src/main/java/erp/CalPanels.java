package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.swing.BorderFactory;
import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JDialog;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;

/** Calendar and meetings: agenda (day / week / month), events, meetings with a join link, RSVP, availability check, to-dos and settings.
 *  The server keeps UTC; the screen shows the computer's own time zone. */
public final class CalPanels {
    private CalPanels() { }

    // ------------------------------------------------------------ time + payload helpers (same rules in every desktop app)
    public static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'").withZone(ZoneId.of("UTC"));

    public static ZonedDateTime toLocal(String iso) { return LocalDateTime.parse(iso.substring(0, 19)).atZone(ZoneId.of("UTC")).withZoneSameInstant(ZoneId.systemDefault()); }
    public static String toUtcIso(ZonedDateTime d) { return ISO.format(d.toInstant()); }
    public static String fmtLocal(String iso) { return iso == null || iso.isEmpty() ? "" : FMT.format(toLocal(iso)); }

    /** "yyyy-MM-dd HH:mm" in local time -> UTC ISO; "" when empty; IllegalArgumentException when malformed */
    public static String parseLocal(String s) {
        s = s == null ? "" : s.trim();
        if (s.isEmpty()) return "";
        try { return toUtcIso(LocalDateTime.parse(s, FMT).atZone(ZoneId.systemDefault())); } catch (Exception e) { throw new IllegalArgumentException(t("cal.u.badtime")); }
    }

    public static ZonedDateTime[] period(String view, LocalDate anchor) {
        LocalDate a, b;
        if (view.equals("day")) { a = anchor; b = a.plusDays(1); }
        else if (view.equals("week")) { a = anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)); b = a.plusDays(7); }
        else { a = anchor.withDayOfMonth(1); b = a.plusMonths(1); }
        return new ZonedDateTime[]{a.atStartOfDay(ZoneId.systemDefault()), b.atStartOfDay(ZoneId.systemDefault())};
    }

    public static LocalDate shift(String view, LocalDate anchor, int n) {
        return view.equals("day") ? anchor.plusDays(n) : view.equals("week") ? anchor.plusWeeks(n) : anchor.withDayOfMonth(1).plusMonths(n);
    }

    /** form values -> request body; IllegalArgumentException carries the message for the user */
    public static Map<String, Object> eventPayload(Map<String, Object> v) {
        String kind = Json.str(v.get("kind"));
        if (Json.str(v.get("title")).trim().isEmpty()) throw new IllegalArgumentException(t("cal.u.needtitle"));
        String start = parseLocal(Json.str(v.get("start"))), end = parseLocal(Json.str(v.get("end"))), until = Json.str(v.get("until")).trim(), untilIso = null;
        if (!until.isEmpty()) { try { untilIso = toUtcIso(LocalDate.parse(until).atStartOfDay(ZoneId.systemDefault())); } catch (Exception e) { throw new IllegalArgumentException(t("cal.u.badtime")); } }
        if (!kind.equals("todo") && start.isEmpty()) throw new IllegalArgumentException(t("cal.u.badtime"));
        if (!kind.equals("todo") && (end.isEmpty() || end.compareTo(start) <= 0)) end = ISO.format(Instant.parse(start).plusSeconds(3600));
        List<Object> guests = new ArrayList<>();
        for (String g : Json.str(v.get("guests")).split("[,;\\s]+")) if (!g.trim().isEmpty()) guests.add(g.trim());
        String rem = Json.str(v.get("remind")).trim();
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("kind", kind); b.put("title", Json.str(v.get("title")).trim()); b.put("start", start.isEmpty() ? null : start); b.put("end", kind.equals("todo") ? null : end);
        b.put("notes", Json.str(v.get("notes"))); b.put("location", Json.str(v.get("location"))); b.put("attendees", kind.equals("todo") ? new ArrayList<>() : Json.arr(v.get("attendees"))); b.put("guests", guests);
        b.put("repeat", v.get("repeat") == null ? "none" : Json.str(v.get("repeat"))); b.put("repeatUntil", untilIso); b.put("remindMinutes", rem.matches("\\d+") ? (Object) Long.parseLong(rem) : null);
        b.put("priority", v.get("priority") == null ? "normal" : Json.str(v.get("priority")));
        return b;
    }

    static String kindName(String k) { return t(k.equals("meeting") ? "cal.u.meeting" : k.equals("todo") ? "cal.u.todo" : "cal.u.event"); }
    static String me() { return Api.I.username; }

    static void open(String url) { try { java.awt.Desktop.getDesktop().browse(java.net.URI.create(url)); } catch (Exception e) { /* no browser in this environment */ } }

    static final class Opt {
        final String v, l;
        Opt(String v, String l) { this.v = v; this.l = l; }
        @Override public String toString() { return l; }
    }

    // ------------------------------------------------------------ event dialog
    static final class EventDlg extends JDialog {
        Map<String, Object> body;
        final JComboBox<Opt> kind = new JComboBox<>(), repeat = new JComboBox<>(), prio = new JComboBox<>();
        final JTextField title, start, end, location, until, remind, guests;
        final JTextArea notes;
        final JList<String> att;
        final List<String> attUsers = new ArrayList<>();
        final JLabel avail = Ui.label(" ", "dim"), err = Ui.label(" ", "error");

        @SuppressWarnings("unchecked")
        EventDlg(Component parent, Map<String, Object> item, boolean isNew, List<Object> people) {
            super(javax.swing.SwingUtilities.getWindowAncestor(parent), isNew ? t("cal.u.new") : t("cal.u.edit"), ModalityType.APPLICATION_MODAL);
            Map<String, Object> d = Json.obj(item.get("data"));
            for (String k : new String[]{"event", "meeting", "todo"}) kind.addItem(new Opt(k, kindName(k)));
            select(kind, item.get("kind") == null ? "event" : Json.str(item.get("kind")));
            for (String[] r : new String[][]{{"none", "cal.u.none"}, {"daily", "cal.u.daily"}, {"weekly", "cal.u.weekly"}, {"monthly", "cal.u.monthly"}}) repeat.addItem(new Opt(r[0], t(r[1])));
            select(repeat, d.get("repeat") == null ? "none" : Json.str(d.get("repeat")));
            for (String k : new String[]{"low", "normal", "high"}) prio.addItem(new Opt(k, k));
            select(prio, d.get("priority") == null ? "normal" : Json.str(d.get("priority")));
            LocalDateTime now = LocalDateTime.now().withMinute(0).withSecond(0).withNano(0).plusHours(1);
            title = new JTextField(Json.str(item.get("title")), 30);
            start = new JTextField(item.get("start") != null ? fmtLocal(Json.str(item.get("start"))) : FMT.format(now));
            end = new JTextField(item.get("end") != null ? fmtLocal(Json.str(item.get("end"))) : FMT.format(now.plusHours(1)));
            location = new JTextField(Json.str(d.get("location")));
            notes = new JTextArea(Json.str(d.get("notes")), 3, 30);
            until = new JTextField(Json.str(d.get("repeatUntil")).length() >= 10 ? Json.str(d.get("repeatUntil")).substring(0, 10) : "");
            remind = new JTextField(isNew ? "10" : d.get("remind") == null ? "" : Json.str(d.get("remind")));
            List<String> g = new ArrayList<>(); for (Object o : Json.arr(d.get("guests"))) g.add(String.valueOf(o));
            guests = new JTextField(String.join(", ", g));
            List<Object> chosen = Json.arr(d.get("attendees"));
            DefaultListModel<String> model = new DefaultListModel<>();
            for (Object po : people) {
                Map<String, Object> p = Json.obj(po);
                if (Json.str(p.get("username")).equalsIgnoreCase(me())) continue;
                attUsers.add(Json.str(p.get("username"))); model.addElement(Json.str(p.get("displayName")) + " (" + Json.str(p.get("username")) + ")");
            }
            att = new JList<>(model); att.setVisibleRowCount(4);
            for (int i = 0; i < attUsers.size(); i++) if (chosen.contains(attUsers.get(i))) att.addSelectionInterval(i, i);
            JPanel form = new JPanel(new GridBagLayout()); form.setBorder(BorderFactory.createEmptyBorder(12, 12, 4, 12));
            String[] keys = {"cal.u.type", "cal.u.title", "cal.u.start", "cal.u.end", "cal.u.location", "cal.u.notes", "cal.u.repeat", "cal.u.until", "cal.u.remind", "cal.u.priority", "cal.u.attendees", "cal.u.guests"};
            Component[] cs = {kind, title, start, end, location, new JScrollPane(notes), repeat, until, remind, prio, new JScrollPane(att), guests};
            for (int i = 0; i < keys.length; i++) {
                GridBagConstraints c = new GridBagConstraints(); c.gridx = 0; c.gridy = i; c.anchor = GridBagConstraints.NORTHWEST; c.insets = new java.awt.Insets(3, 0, 3, 10); form.add(new JLabel(t(keys[i])), c);
                c = new GridBagConstraints(); c.gridx = 1; c.gridy = i; c.fill = GridBagConstraints.HORIZONTAL; c.weightx = 1; c.insets = new java.awt.Insets(3, 0, 3, 0); form.add(cs[i], c);
            }
            JButton save = Ui.button(t("cal.u.save"), this::submit, "primary");
            JPanel foot = new JPanel(new FlowLayout(FlowLayout.RIGHT)); foot.add(err); foot.add(Ui.button(t("cal.u.avail"), this::check, null)); foot.add(Ui.button(t("common.cancel"), this::dispose, null)); foot.add(save);
            JPanel south = new JPanel(new BorderLayout()); south.add(avail, BorderLayout.NORTH); south.add(foot);
            setLayout(new BorderLayout()); add(form); add(south, BorderLayout.SOUTH);
            if (!isNew && !Json.str(item.get("owner")).equalsIgnoreCase(me()) && !Api.I.can("cal.settings")) save.setEnabled(false);
            pack(); setLocationRelativeTo(parent);
        }

        static void select(JComboBox<Opt> cb, String v) { for (int i = 0; i < cb.getItemCount(); i++) if (cb.getItemAt(i).v.equals(v)) cb.setSelectedIndex(i); }
        List<Object> attendees() { List<Object> a = new ArrayList<>(); for (int i : att.getSelectedIndices()) a.add(attUsers.get(i)); return a; }

        Map<String, Object> values() {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("kind", ((Opt) kind.getSelectedItem()).v); v.put("title", title.getText()); v.put("start", start.getText()); v.put("end", end.getText()); v.put("location", location.getText()); v.put("notes", notes.getText());
            v.put("repeat", ((Opt) repeat.getSelectedItem()).v); v.put("until", until.getText()); v.put("remind", remind.getText()); v.put("priority", ((Opt) prio.getSelectedItem()).v); v.put("attendees", attendees()); v.put("guests", guests.getText());
            return v;
        }

        void check() {
            String s, e;
            try { s = parseLocal(start.getText()); e = parseLocal(end.getText()); } catch (IllegalArgumentException ex) { avail.setText(ex.getMessage()); return; }
            if (s.isEmpty()) { avail.setText(t("cal.u.badtime")); return; }
            List<Object> users = new ArrayList<>(); users.add(me()); users.addAll(attendees());
            String a = toUtcIso(toLocal(s).minusHours(12)), b = toUtcIso(toLocal(e.isEmpty() ? s : e).plusHours(12)); String ee = e;
            Map<String, Object> req = new LinkedHashMap<>(); req.put("users", users); req.put("from", a); req.put("to", b);
            Ui.async(() -> Json.obj(Api.I.cal("POST", "freebusy", req)), res -> {
                List<String> lines = new ArrayList<>();
                for (Object uo : users) {
                    List<String> clash = new ArrayList<>();
                    for (Object xo : Json.arr(res.get(String.valueOf(uo)))) {
                        Map<String, Object> x = Json.obj(xo);
                        if (Json.str(x.get("s")).compareTo(ee) < 0 && Json.str(x.get("e")).compareTo(s) > 0) clash.add(fmtLocal(Json.str(x.get("s"))).substring(11) + "-" + fmtLocal(Json.str(x.get("e"))).substring(11));
                    }
                    lines.add(uo + ": " + (clash.isEmpty() ? t("cal.u.free") : t("cal.u.busy") + " " + String.join(", ", clash)));
                }
                avail.setText("<html>" + String.join("<br>", lines) + "</html>"); pack();
            }, avail::setText);
        }

        void submit() {
            try { body = eventPayload(values()); } catch (IllegalArgumentException ex) { err.setText(ex.getMessage()); return; }
            dispose();
        }
    }

    // ------------------------------------------------------------ agenda
    public static final class AgendaPanel extends JPanel implements Reloadable {
        public String view = "week";
        public LocalDate anchor = LocalDate.now();
        public List<Map<String, Object>> items = new ArrayList<>();
        List<Object> people = new ArrayList<>();
        public final JComboBox<Opt> vsel = new JComboBox<>();
        public final JLabel rng = Ui.label(" ", "dim"), err = Ui.label(" ", "error");
        public final Ui.DataTable table = new Ui.DataTable(t("cal.u.when"), t("cal.u.title"), t("cal.u.type"), t("cal.u.where"), t("cal.u.rsvp"));
        public final Map<String, JButton> btn = new LinkedHashMap<>();

        AgendaPanel() {
            super(new BorderLayout(0, 6));
            setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
            for (String k : new String[]{"day", "week", "month"}) vsel.addItem(new Opt(k, t("cal.u." + k)));
            vsel.setSelectedIndex(1);
            vsel.addActionListener(e -> { view = ((Opt) vsel.getSelectedItem()).v; reload(); });
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            bar.add(Ui.button("‹", () -> { anchor = shift(view, anchor, -1); reload(); }, null));
            bar.add(Ui.button(t("cal.u.today"), () -> { anchor = LocalDate.now(); reload(); }, null));
            bar.add(Ui.button("›", () -> { anchor = shift(view, anchor, 1); reload(); }, null));
            bar.add(vsel); bar.add(rng);
            bar.add(Ui.button(t("cal.u.new"), () -> edit(new LinkedHashMap<>(), true), "primary"));
            bar.add(Ui.button(t("cal.u.instant"), this::instant, null));
            JPanel top = new JPanel(new BorderLayout()); top.add(bar); top.add(err, BorderLayout.SOUTH);
            JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 4));
            add("edit", () -> edit(cur(), false), row); add("join", () -> joinInfo(r -> { open(Json.str(r.get("url"))); err.setText(t("cal.u.opened")); }), row);
            add("link", () -> joinInfo(r -> { java.awt.Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new java.awt.datatransfer.StringSelection(Json.str(r.get("url"))), null); err.setText(t("cal.u.copied") + ": " + Json.str(r.get("url"))); }), row);
            add("ics", this::ics, row); add("accept", () -> rsvp("accepted"), row); add("maybe", () -> rsvp("maybe"), row); add("decline", () -> rsvp("declined"), row); add("delete", this::delete, row);
            table.getSelectionModel().addListSelectionListener(e -> sel());
            table.onOpen(() -> edit(cur(), false));
            add(top, BorderLayout.NORTH); add(new JScrollPane(table)); add(row, BorderLayout.SOUTH);
            sel();
        }

        void add(String key, Runnable r, JPanel row) { JButton b = Ui.button(t("cal.u." + key), r, null); btn.put(key, b); row.add(b); }
        @SuppressWarnings("unchecked") Map<String, Object> cur() { Object o = table.selected(); return o == null ? new LinkedHashMap<>() : (Map<String, Object>) o; }

        @Override public void reload() {
            ZonedDateTime[] p = period(view, anchor);
            rng.setText(p[0].toLocalDate() + " → " + p[1].toLocalDate().minusDays(1)); err.setText(" ");
            Ui.async(() -> {
                List<Map<String, Object>> ev = new ArrayList<>();
                for (Object o : Json.arr(Api.I.cal("GET", "events?from=" + toUtcIso(p[0]) + "&to=" + toUtcIso(p[1]), null))) ev.add(Json.obj(o));
                return new Object[]{ev, Json.arr(Api.I.cal("GET", "people", null))};
            }, r -> { items = castList(r[0]); people = castObjs(r[1]); paint(); }, err::setText);
        }

        @SuppressWarnings("unchecked") static List<Map<String, Object>> castList(Object o) { return (List<Map<String, Object>>) o; }
        @SuppressWarnings("unchecked") static List<Object> castObjs(Object o) { return (List<Object>) o; }

        public void paint() {
            List<String[]> rows = new ArrayList<>();
            for (Map<String, Object> e : items) {
                Map<String, Object> d = Json.obj(e.get("data"));
                rows.add(new String[]{fmtLocal(Json.str(e.get("start"))) + (e.get("end") != null ? " → " + fmtLocal(Json.str(e.get("end"))).substring(11) : ""), Json.str(e.get("title")) + (Boolean.TRUE.equals(e.get("occurrence")) ? " ↻" : ""),
                    kindName(Json.str(e.get("kind"))), Json.str(d.get("location")), Json.str(Json.obj(d.get("rsvp")).get(me()))});
            }
            table.fill(rows, items); sel();
        }

        void sel() {
            Map<String, Object> e = cur(); boolean has = !e.isEmpty();
            boolean mine = has && (Json.str(e.get("owner")).equalsIgnoreCase(me()) || Api.I.can("cal.settings"));
            boolean invited = has && Json.arr(Json.obj(e.get("data")).get("attendees")).contains(me());
            boolean meeting = has && "meeting".equals(e.get("kind"));
            btn.get("edit").setEnabled(has); btn.get("ics").setEnabled(has); btn.get("join").setEnabled(meeting); btn.get("link").setEnabled(meeting);
            for (String k : new String[]{"accept", "maybe", "decline"}) btn.get(k).setEnabled(invited);
            btn.get("delete").setEnabled(mine);
        }

        void edit(Map<String, Object> item, boolean isNew) {
            if (!isNew && item.isEmpty()) return;
            EventDlg d = new EventDlg(this, item, isNew, people);
            d.setVisible(true);
            if (d.body == null) return;
            Ui.async(() -> isNew ? Api.I.cal("POST", "events", d.body) : Api.I.cal("PUT", "events/" + Json.str(item.get("id")), d.body), r -> reload(), err::setText);
        }

        void joinInfo(java.util.function.Consumer<Map<String, Object>> cb) {
            String id = Json.str(cur().get("id"));
            Ui.async(() -> Json.obj(Api.I.cal("POST", "events/" + id + "/join", new LinkedHashMap<>())), cb, err::setText);
        }

        void ics() {
            Map<String, Object> e = cur();
            JFileChooser fc = new JFileChooser(); fc.setSelectedFile(new java.io.File(Json.str(e.get("title")) + ".ics"));
            if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
            Path p = fc.getSelectedFile().toPath();
            Ui.async(() -> { try { Files.write(p, Api.I.raw("/calendar/events/" + Json.str(e.get("id")) + "/ics")); } catch (java.io.IOException ex) { throw new Api.ApiException(ex.getMessage()); } return Boolean.TRUE; }, r -> { }, err::setText);
        }

        void rsvp(String r) {
            String id = Json.str(cur().get("id")); Map<String, Object> b = new LinkedHashMap<>(); b.put("response", r);
            Ui.async(() -> Api.I.cal("POST", "events/" + id + "/rsvp", b), x -> reload(), err::setText);
        }

        void delete() {
            String id = Json.str(cur().get("id"));
            if (id.isEmpty() || !Ui.ask(this, t("cal.u.confirmdel"), t("common.yes"), t("common.no"))) return;
            Ui.async(() -> Api.I.cal("DELETE", "events/" + id, null), x -> reload(), err::setText);
        }

        void instant() {
            Map<String, Object> b = new LinkedHashMap<>(); b.put("title", t("cal.u.instant")); b.put("attendees", new ArrayList<>());
            Ui.async(() -> Json.obj(Api.I.cal("POST", "meetings/instant", b)), r -> { open(Json.str(r.get("url"))); reload(); }, err::setText);
        }
    }

    // ------------------------------------------------------------ to-dos
    public static final class TodosPanel extends JPanel implements Reloadable {
        public List<Map<String, Object>> items = new ArrayList<>();
        public final JTextField title = new JTextField(18), due = new JTextField(14);
        final JComboBox<Opt> prio = new JComboBox<>();
        public final Ui.DataTable table = new Ui.DataTable(t("cal.u.title"), t("cal.u.due"), t("cal.u.priority"), t("cal.u.done"));
        final JLabel err = Ui.label(" ", "error");

        TodosPanel() {
            super(new BorderLayout(0, 6));
            setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
            for (String k : new String[]{"low", "normal", "high"}) prio.addItem(new Opt(k, k));
            prio.setSelectedIndex(1);
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            bar.add(new JLabel(t("cal.u.title"))); bar.add(title); bar.add(new JLabel(t("cal.u.due"))); bar.add(due); bar.add(prio); bar.add(Ui.button(t("cal.u.add"), this::add, "primary"));
            JPanel top = new JPanel(new BorderLayout()); top.add(bar); top.add(err, BorderLayout.SOUTH);
            JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 4));
            row.add(Ui.button(t("cal.u.toggle"), () -> act("POST", "/done"), null)); row.add(Ui.button(t("cal.u.delete"), () -> act("DELETE", ""), null));
            add(top, BorderLayout.NORTH); add(new JScrollPane(table)); add(row, BorderLayout.SOUTH);
        }

        @SuppressWarnings("unchecked") Map<String, Object> cur() { Object o = table.selected(); return o == null ? null : (Map<String, Object>) o; }

        void act(String method, String suffix) {
            Map<String, Object> x = cur(); if (x == null) return;
            Ui.async(() -> Api.I.cal(method, "events/" + Json.str(x.get("id")) + suffix, method.equals("POST") ? new LinkedHashMap<>() : null), r -> reload(), err::setText);
        }

        @Override public void reload() {
            Ui.async(() -> { List<Map<String, Object>> l = new ArrayList<>(); for (Object o : Json.arr(Api.I.cal("GET", "todos", null))) l.add(Json.obj(o)); return l; }, this::paint, err::setText);
        }

        public void paint(List<Map<String, Object>> l) {
            items = l; List<String[]> rows = new ArrayList<>();
            for (Map<String, Object> x : l) rows.add(new String[]{Json.str(x.get("title")), x.get("start") == null ? "" : fmtLocal(Json.str(x.get("start"))), Json.str(Json.obj(x.get("data")).get("priority")), "Done".equals(x.get("status")) ? "✓" : ""});
            table.fill(rows, l);
        }

        public void add() {
            Map<String, Object> v = new LinkedHashMap<>(); v.put("kind", "todo"); v.put("title", title.getText()); v.put("start", due.getText()); v.put("priority", ((Opt) prio.getSelectedItem()).v); v.put("remind", "");
            Map<String, Object> body;
            try { body = eventPayload(v); } catch (IllegalArgumentException e) { err.setText(e.getMessage()); return; }
            title.setText(""); due.setText("");
            Ui.async(() -> Api.I.cal("POST", "events", body), r -> reload(), err::setText);
        }
    }

    // ------------------------------------------------------------ settings + page
    public static final class SettingsPanel extends JPanel implements Reloadable {
        public final JTextField jitsi = new JTextField(24), ws = new JTextField(8), we = new JTextField(8);
        public final JLabel msg = Ui.label(" ", "dim");

        SettingsPanel() {
            super(new BorderLayout());
            setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));
            JPanel form = new JPanel(new GridBagLayout());
            String[] keys = {"cal.u.jitsi", "cal.u.ws", "cal.u.we"}; Component[] cs = {jitsi, ws, we};
            for (int i = 0; i < 3; i++) {
                GridBagConstraints c = new GridBagConstraints(); c.gridx = 0; c.gridy = i; c.anchor = GridBagConstraints.WEST; c.insets = new java.awt.Insets(4, 0, 4, 10); form.add(new JLabel(t(keys[i])), c);
                c = new GridBagConstraints(); c.gridx = 1; c.gridy = i; c.anchor = GridBagConstraints.WEST; form.add(cs[i], c);
            }
            JPanel south = new JPanel(new FlowLayout(FlowLayout.LEFT)); south.add(Ui.button(t("cal.u.save"), this::save, "primary")); south.add(msg);
            JPanel top = new JPanel(new BorderLayout()); top.add(form, BorderLayout.NORTH); top.add(south);
            add(top, BorderLayout.NORTH);
        }

        @Override public void reload() {
            Ui.async(() -> Json.obj(Api.I.cal("GET", "settings", null)), s -> { jitsi.setText(Json.str(s.get("jitsiDomain"))); ws.setText(Json.str(s.get("workStart"))); we.setText(Json.str(s.get("workEnd"))); }, msg::setText);
        }

        public void save() {
            Map<String, Object> b = new LinkedHashMap<>(); b.put("jitsiDomain", jitsi.getText().trim()); b.put("workStart", ws.getText().trim()); b.put("workEnd", we.getText().trim());
            Ui.async(() -> Api.I.cal("PUT", "settings", b), r -> msg.setText(t("cal.u.saved")), msg::setText);
        }
    }

    public static final class CalendarPanel extends JPanel implements Reloadable {
        public final JTabbedPane tabs = new JTabbedPane();
        public final AgendaPanel agenda = new AgendaPanel();
        public final TodosPanel todos = new TodosPanel();
        public SettingsPanel settings;
        final List<Reloadable> views = new ArrayList<>();

        public CalendarPanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            add(Ui.label(t("tab.cal"), "title"), BorderLayout.NORTH);
            tabs.addTab(t("cal.u.agenda"), agenda); views.add(agenda); tabs.addTab(t("cal.u.todos"), todos); views.add(todos);
            if (Api.I.can("cal.settings")) { settings = new SettingsPanel(); tabs.addTab(t("cal.u.settings"), settings); views.add(settings); }
            tabs.addChangeListener(e -> reload());
            add(tabs);
        }

        @Override public void reload() { int i = tabs.getSelectedIndex(); if (i >= 0) views.get(i).reload(); }
    }
}
