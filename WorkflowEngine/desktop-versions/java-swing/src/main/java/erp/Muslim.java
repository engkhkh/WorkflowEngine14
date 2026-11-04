package erp;

import static erp.I18n.t;

import java.awt.BasicStroke;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.ComponentOrientation;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.Insets;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.awt.image.RescaleOp;
import java.io.File;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.nio.file.Files;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.chrono.HijrahDate;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.prefs.Preferences;
import javax.imageio.ImageIO;
import javax.swing.BorderFactory;
import javax.swing.DefaultComboBoxModel;
import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSpinner;
import javax.swing.JTabbedPane;
import javax.swing.JTextField;
import javax.swing.KeyStroke;
import javax.swing.SpinnerNumberModel;
import javax.swing.Timer;
import javax.swing.table.DefaultTableModel;

/** Muslim workspace: prayer times (reminders, Qibla, Hijri date) and the Holy Quran as Mushaf page images.
 *  Same behaviour as the portal's Muslim module; the settings live on this computer. */
public final class Muslim {
    private static final Map<String, Object> MF = Json.obj(Prayer.SPEC.get("mushaf"));
    private static final int PAGES = ((Number) MF.get("pages")).intValue();
    private static final int[] SURAH_START = ints(MF.get("surahStart")), JUZ_START = ints(MF.get("juzStart"));
    private static final List<Object> SURAH_AR = Json.arr(MF.get("surahAr"));
    private static final Map<String, Object> CITIES = Json.obj(Prayer.SPEC.get("cities"));

    private Muslim() { }

    private static int[] ints(Object o) { List<Object> l = Json.arr(o); int[] r = new int[l.size()]; for (int i = 0; i < r.length; i++) r[i] = ((Number) l.get(i)).intValue(); return r; }

    static int clampPage(int p) { return Math.min(PAGES, Math.max(1, p)); }
    static int surahOfPage(int p) { int n = 1; for (int i = 0; i < SURAH_START.length; i++) if (SURAH_START[i] <= p) n = i + 1; return n; }
    static int juzOfPage(int p) { int n = 1; for (int i = 0; i < JUZ_START.length; i++) if (JUZ_START[i] <= p) n = i + 1; return n; }
    static String surahName(int n) { return Json.str(SURAH_AR.get(n - 1)); }

    // ------------------------------------------------------------------ settings
    /** Everything the page remembers (stored as one JSON text in the user's preferences). */
    static final class Store {
        private final Preferences prefs = Preferences.userNodeForPackage(Muslim.class);
        final Map<String, Object> s = new LinkedHashMap<>();

        Store() {
            String cc = Locale.getDefault().getCountry();
            List<Object> list = Json.arr(CITIES.get(cc));
            List<Object> c = list.isEmpty() ? null : Json.arr(list.get(0));
            s.put("cc", c == null ? "" : cc); s.put("city", c == null ? "" : c.get(0));
            s.put("lat", c == null ? 21.4225 : c.get(1)); s.put("lng", c == null ? 39.8262 : c.get(2)); s.put("tz", c == null ? "Asia/Riyadh" : c.get(3));
            s.put("placeSet", c != null); s.put("method", Prayer.defaultMethod(cc)); s.put("hanafi", c != null && Prayer.defaultHanafi(cc));
            s.put("highLat", "angle"); s.put("hijriAdjust", 0L); s.put("time24", false); s.put("sound", "chime");
            Map<String, Object> adj = new LinkedHashMap<>(), rem = new LinkedHashMap<>();
            for (String p : Prayer.PRAYERS) {
                adj.put(p, 0L);
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("on", !"sunrise".equals(p)); r.put("before", "sunrise".equals(p) ? 15L : 10L);
                rem.put(p, r);
            }
            s.put("adjust", adj); s.put("remind", rem);
            s.put("mpage", 1L); s.put("mzoom", 100L); s.put("mtwo", false); s.put("mnight", false); s.put("mbase", ""); s.put("mmode", "img"); s.put("mtheme", "rose"); s.put("pmarks", new ArrayList<Object>());
            try {
                String raw = prefs.get("muslim", "");
                if (!raw.isEmpty()) {
                    Map<String, Object> v = Json.obj(Json.parse(raw));
                    for (Map.Entry<String, Object> e : v.entrySet()) {
                        if (e.getKey().equals("remind")) { Map<String, Object> m = Json.obj(s.get("remind")); m.putAll(Json.obj(e.getValue())); }
                        else if (e.getKey().equals("adjust")) { Json.obj(s.get("adjust")).putAll(Json.obj(e.getValue())); }
                        else s.put(e.getKey(), e.getValue());
                    }
                }
            } catch (Exception ignored) { /* keep defaults */ }
        }

        void save() { try { prefs.put("muslim", Json.write(s)); } catch (Exception ignored) { /* not fatal */ } }
        String str(String k) { return Json.str(s.get(k)); }
        double dbl(String k) { return ((Number) s.get(k)).doubleValue(); }
        int num(String k) { return ((Number) s.get(k)).intValue(); }
        boolean bool(String k) { return Boolean.TRUE.equals(s.get(k)); }

        Prayer.Opts opts() {
            Prayer.Opts o = new Prayer.Opts();
            o.method = str("method"); o.hanafi = bool("hanafi"); o.highLat = str("highLat");
            for (Map.Entry<String, Object> e : Json.obj(s.get("adjust")).entrySet()) o.adjust.put(e.getKey(), ((Number) e.getValue()).intValue());
            return o;
        }

        Map<String, Object> remind(String p) { return Json.obj(Json.obj(s.get("remind")).get(p)); }
        List<Object> marks() { return Json.arr(s.get("pmarks")); }
    }

    static final Store ST = new Store();

    private static String pname(String p) { return t("mus." + p); }
    private static String pname(int i) { return pname(Prayer.PRAYERS[i]); }

    private static String countryName(String cc) { return new Locale("", cc).getDisplayCountry(I18n.rtl() ? new Locale("ar") : Locale.ENGLISH); }

    private static String fmtTime(Long ms) {
        if (ms == null) return "—";
        ZonedDateTime z = Instant.ofEpochSecond(Math.round(ms / 60000.0) * 60).atZone(ZoneId.of(ST.str("tz")));
        return ST.bool("time24") ? String.format("%02d:%02d", z.getHour(), z.getMinute())
                : String.format("%d:%02d %s", z.getHour() % 12 == 0 ? 12 : z.getHour() % 12, z.getMinute(), z.getHour() < 12 ? "AM" : "PM");
    }

    private static final String[] HIJRI_EN = {"Muharram", "Safar", "Rabi' al-awwal", "Rabi' al-thani", "Jumada al-ula", "Jumada al-akhira", "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah"};
    private static final String[] HIJRI_AR = {"محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"};

    /** Hijri (Umm al-Qura) date in the place's zone; after Maghrib the Islamic day has begun, so it moves on by one. */
    static String hijri(Prayer.Day today) {
        try {
            long now = System.currentTimeMillis();
            boolean after = today.at[4] != null && now >= today.at[4];
            LocalDate d = Instant.ofEpochMilli(now).atZone(ZoneId.of(ST.str("tz"))).toLocalDate().plusDays((after ? 1 : 0) + ST.num("hijriAdjust"));
            HijrahDate h = HijrahDate.from(d);
            int m = h.get(java.time.temporal.ChronoField.MONTH_OF_YEAR);
            return h.get(java.time.temporal.ChronoField.DAY_OF_MONTH) + " " + (I18n.rtl() ? HIJRI_AR : HIJRI_EN)[m - 1] + " " + h.get(java.time.temporal.ChronoField.YEAR);
        } catch (Exception e) { return ""; }
    }

    /** A panel that follows the width of its scroll pane (so a settings form never scrolls sideways). */
    private static final class WidthTracking extends JPanel implements javax.swing.Scrollable {
        WidthTracking(java.awt.LayoutManager l) { super(l); }
        @Override public Dimension getPreferredScrollableViewportSize() { return getPreferredSize(); }
        @Override public int getScrollableUnitIncrement(java.awt.Rectangle r, int o, int d) { return 20; }
        @Override public int getScrollableBlockIncrement(java.awt.Rectangle r, int o, int d) { return 120; }
        @Override public boolean getScrollableTracksViewportWidth() { return true; }
        @Override public boolean getScrollableTracksViewportHeight() { return false; }
    }

    // ------------------------------------------------------------------ prayer times
    private static final class Dial extends JComponent {
        double deg;
        Dial() { setPreferredSize(new Dimension(90, 90)); }
        @Override protected void paintComponent(Graphics g0) {
            Graphics2D g = (Graphics2D) g0.create();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setColor(new Color(0xCB, 0xD5, 0xE1)); g.setStroke(new BasicStroke(2f)); g.drawOval(5, 5, 80, 80);
            g.setColor(Ui.DIM); g.drawString("N", 41, 16);
            g.translate(45, 45); g.rotate(Math.toRadians(deg));
            g.setColor(new Color(0x16, 0xA3, 0x4A)); g.setStroke(new BasicStroke(4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.drawLine(0, 6, 0, -28); g.fillRect(-6, -38, 12, 12);
            g.dispose();
        }
    }

    public static final class MuslimPanel extends JPanel implements Reloadable {
        private final JTabbedPane tabs = new JTabbedPane();
        private final TimesTab times = new TimesTab();
        private final QuranTab quran = new QuranTab();

        public MuslimPanel() {
            super(new BorderLayout());
            tabs.addTab(t("mus.tab.times"), times);
            tabs.addTab(t("mus.tab.quran"), quran);
            JPanel p = Ui.page(t("module.muslim"), null, tabs, null);
            add(p);
        }

        @Override public void reload() { times.refresh(); }
    }

    private static final class TimesTab extends JPanel {
        private final JLabel warn = new JLabel("<html>" + t("mus.pickplace") + "</html>"), place = Ui.label(" ", "title"), date = Ui.label(" ", "dim"), next = new JLabel(" "), cd = new JLabel("--:--:--"), qibla = Ui.label(" ", "dim"), polar = Ui.label(t("mus.polar"), "dim");
        private final Dial dial = new Dial();
        private final DefaultTableModel model = new DefaultTableModel() { @Override public boolean isCellEditable(int r, int c) { return false; } };
        private final javax.swing.JTable table = new javax.swing.JTable(model);
        private boolean monthly, loading;
        private long nextAt;
        private final JButton dayB = Ui.button(t("mus.day"), () -> setMonthly(false), null), monB = Ui.button(t("mus.month"), () -> setMonthly(true), "plain");
        private final JComboBox<String> country = new JComboBox<>(), city = new JComboBox<>(), tz = new JComboBox<>(), method = new JComboBox<>(), asr = new JComboBox<>(), hl = new JComboBox<>(), hj = new JComboBox<>(), clock = new JComboBox<>(), sound = new JComboBox<>();
        private final List<String> countryCodes = new ArrayList<>(), methodIds = new ArrayList<>();
        private final JSpinner lat = new JSpinner(new SpinnerNumberModel(0.0, -90.0, 90.0, 0.01)), lng = new JSpinner(new SpinnerNumberModel(0.0, -180.0, 180.0, 0.01));
        private final JSpinner[] adj = new JSpinner[6], remMin = new JSpinner[6];
        private final JCheckBox[] remOn = new JCheckBox[6];
        private final java.util.Set<String> fired = new java.util.HashSet<>();

        TimesTab() {
            super(new BorderLayout(12, 0));
            warn.setOpaque(true); warn.setBackground(new Color(0xFE, 0xF3, 0xC7)); warn.setForeground(new Color(0x92, 0x40, 0x0E)); warn.setBorder(BorderFactory.createEmptyBorder(8, 10, 8, 10));
            cd.setFont(cd.getFont().deriveFont(Font.BOLD, 34f)); cd.setForeground(Ui.PRIMARY);
            next.setFont(next.getFont().deriveFont(15f));
            JPanel info = new JPanel(new GridBagLayout()); info.setOpaque(false);
            GridBagConstraints ic = new GridBagConstraints(); ic.gridx = 0; ic.weightx = 1; ic.anchor = GridBagConstraints.LINE_START; ic.fill = GridBagConstraints.HORIZONTAL;
            for (JComponent c : new JComponent[]{place, date, next, cd}) info.add(c, ic);
            JPanel qb = new JPanel(new BorderLayout()); qb.setOpaque(false); qb.add(dial, BorderLayout.CENTER); qb.add(qibla, BorderLayout.SOUTH);
            JPanel hero = new JPanel(new BorderLayout()); hero.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(0xE2, 0xE8, 0xF0)), BorderFactory.createEmptyBorder(10, 12, 10, 12)));
            hero.add(info); hero.add(qb, BorderLayout.LINE_END);
            JPanel seg = new JPanel(new FlowLayout(FlowLayout.TRAILING, 4, 0)); seg.setOpaque(false); seg.add(dayB); seg.add(monB);
            JPanel head = new JPanel(new BorderLayout(0, 6)); head.setOpaque(false);
            head.add(warn, BorderLayout.NORTH); head.add(hero, BorderLayout.CENTER);
            JPanel segRow = new JPanel(new BorderLayout()); segRow.add(Ui.label(t("mus.today"), "title"), BorderLayout.LINE_START); segRow.add(seg, BorderLayout.LINE_END);
            JPanel left = new JPanel(new BorderLayout(0, 6));
            JPanel top = new JPanel(new BorderLayout(0, 8)); top.add(head, BorderLayout.NORTH); top.add(segRow, BorderLayout.SOUTH);
            left.add(top, BorderLayout.NORTH);
            table.setRowHeight(28); table.getTableHeader().setReorderingAllowed(false);
            table.addMouseListener(new java.awt.event.MouseAdapter() {
                @Override public void mouseClicked(java.awt.event.MouseEvent e) { bell(table.rowAtPoint(e.getPoint()), table.columnAtPoint(e.getPoint())); }
            });
            left.add(new JScrollPane(table), BorderLayout.CENTER); left.add(polar, BorderLayout.SOUTH);
            add(left, BorderLayout.CENTER);

            // ---- settings
            countryCodes.add("");
            country.addItem(t("mus.custom"));
            List<String> ccs = new ArrayList<>(CITIES.keySet());
            ccs.sort((a, b) -> countryName(a).compareToIgnoreCase(countryName(b)));
            for (String cc : ccs) { countryCodes.add(cc); country.addItem(countryName(cc)); }
            for (String z : new TreeSet<>(ZoneId.getAvailableZoneIds())) tz.addItem(z);
            for (Object m : Prayer.METHODS) { methodIds.add(Json.str(Json.obj(m).get("id"))); method.addItem(Json.str(Json.obj(m).get("name"))); }
            asr.addItem(t("mus.asr.std")); asr.addItem(t("mus.asr.hanafi"));
            for (String k : new String[]{"angle", "seventh", "middle"}) hl.addItem(t("mus.hl." + k));
            for (int n = -2; n <= 2; n++) hj.addItem(n > 0 ? "+" + n : String.valueOf(n));
            clock.addItem("12 h"); clock.addItem("24 h");
            sound.addItem(t("mus.sound.chime")); sound.addItem(t("mus.sound.none"));
            JPanel form = new WidthTracking(new GridBagLayout());
            GridBagConstraints g = new GridBagConstraints();
            g.insets = new Insets(3, 3, 3, 3); g.fill = GridBagConstraints.HORIZONTAL; g.gridy = 0;
            java.util.function.BiConsumer<String, JComponent> row = (txt, w) -> {
                g.gridx = 0; g.weightx = 0; form.add(new JLabel(txt), g);
                g.gridx = 1; g.weightx = 1; form.add(w, g); g.gridy++;
            };
            g.gridx = 0; g.gridwidth = 2; form.add(Ui.label(t("mus.place"), "title"), g); g.gridwidth = 1; g.gridy++;
            row.accept(t("mus.country"), country); row.accept(t("mus.city"), city); row.accept(t("mus.lat"), lat); row.accept(t("mus.lng"), lng); row.accept(t("mus.tz"), tz);
            row.accept(t("mus.method"), method); row.accept(t("mus.asr.label"), asr); row.accept(t("mus.highlat"), hl); row.accept(t("mus.hijriadj"), hj); row.accept(t("mus.clock"), clock);
            g.gridx = 0; g.gridwidth = 2; form.add(Ui.label(t("mus.adjhelp"), "dim"), g); g.gridwidth = 1; g.gridy++;
            for (int i = 0; i < 6; i++) { adj[i] = new JSpinner(new SpinnerNumberModel(0, -60, 60, 1)); row.accept(pname(i), adj[i]); }
            g.gridx = 0; g.gridwidth = 2; form.add(Ui.label(t("mus.reminders"), "title"), g); g.gridwidth = 1; g.gridy++;
            for (int i = 0; i < 6; i++) {
                remOn[i] = new JCheckBox(pname(i)); remMin[i] = new JSpinner(new SpinnerNumberModel(10, 0, 120, 1));
                JPanel r = new JPanel(new BorderLayout(6, 0)); r.add(remMin[i], BorderLayout.CENTER); r.add(new JLabel(t("mus.minbefore", "n", "").trim()), BorderLayout.LINE_END);
                row.accept("", r);
                // check box goes in the label column
                form.remove(form.getComponentCount() - 2);
                g.gridx = 0; g.gridy--; g.weightx = 0; form.add(remOn[i], g); g.gridy++;
            }
            row.accept(t("mus.sound"), sound);
            g.gridx = 0; g.gridwidth = 2; form.add(Ui.button(t("mus.testremind"), () -> fire(0, 10), null), g);
            g.gridy++; g.weighty = 1; g.gridwidth = 2; form.add(new JLabel(), g);
            JScrollPane fs = new JScrollPane(form, JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED, JScrollPane.HORIZONTAL_SCROLLBAR_NEVER); fs.setPreferredSize(new Dimension(400, 0)); fs.setBorder(BorderFactory.createEmptyBorder());
            add(fs, BorderLayout.LINE_END);

            loading = true; loadForm(); loading = false;
            for (JComboBox<String> c : java.util.List.of(country, city, tz, method, asr, hl, hj, clock, sound)) { c.setMinimumSize(new Dimension(60, 26)); c.setPrototypeDisplayValue("xxxxxxxxxxxxxxxxxxxxxx"); c.addActionListener(e -> changed(c)); }
            for (JSpinner s : concat(lat, lng, adj, remMin)) s.addChangeListener(e -> changed(s));
            for (JCheckBox c : remOn) c.addActionListener(e -> changed(c));
            new Timer(1000, e -> tick()).start();
            refresh();
        }

        private static JSpinner[] concat(JSpinner a, JSpinner b, JSpinner[] c, JSpinner[] d) {
            List<JSpinner> l = new ArrayList<>(); l.add(a); l.add(b); l.addAll(java.util.Arrays.asList(c)); l.addAll(java.util.Arrays.asList(d)); return l.toArray(new JSpinner[0]);
        }

        private void setMonthly(boolean m) {
            monthly = m;
            dayB.setBackground(m ? null : Ui.PRIMARY); dayB.setForeground(m ? null : Color.WHITE); dayB.setOpaque(!m); dayB.setBorderPainted(m);
            monB.setBackground(m ? Ui.PRIMARY : null); monB.setForeground(m ? Color.WHITE : null); monB.setOpaque(m); monB.setBorderPainted(!m);
            refresh();
        }

        private void fillCities() {
            String cc = countryCodes.get(Math.max(0, country.getSelectedIndex()));
            DefaultComboBoxModel<String> mdl = new DefaultComboBoxModel<>();
            for (Object c : Json.arr(CITIES.get(cc))) mdl.addElement(Json.str(Json.arr(c).get(0)));
            city.setModel(mdl); city.setEnabled(!cc.isEmpty());
        }

        private void loadForm() {
            country.setSelectedIndex(Math.max(0, countryCodes.indexOf(ST.str("cc"))));
            fillCities(); city.setSelectedItem(ST.str("city"));
            lat.setValue(ST.dbl("lat")); lng.setValue(ST.dbl("lng")); tz.setSelectedItem(ST.str("tz"));
            method.setSelectedIndex(Math.max(0, methodIds.indexOf(ST.str("method")))); asr.setSelectedIndex(ST.bool("hanafi") ? 1 : 0);
            hl.setSelectedIndex(Math.max(0, java.util.Arrays.asList("angle", "seventh", "middle").indexOf(ST.str("highLat"))));
            hj.setSelectedIndex(ST.num("hijriAdjust") + 2); clock.setSelectedIndex(ST.bool("time24") ? 1 : 0);
            for (int i = 0; i < 6; i++) {
                String p = Prayer.PRAYERS[i];
                adj[i].setValue(((Number) Json.obj(ST.s.get("adjust")).get(p)).intValue());
                remOn[i].setSelected(Boolean.TRUE.equals(ST.remind(p).get("on"))); remMin[i].setValue(((Number) ST.remind(p).get("before")).intValue());
            }
            sound.setSelectedIndex("none".equals(ST.str("sound")) ? 1 : 0);
            warn.setVisible(!ST.bool("placeSet"));
        }

        private void changed(Object src) {
            if (loading) return;
            Map<String, Object> s = ST.s;
            if (src == country) {
                String cc = countryCodes.get(Math.max(0, country.getSelectedIndex()));
                if (!cc.isEmpty()) {
                    List<Object> c = Json.arr(Json.arr(CITIES.get(cc)).get(0));
                    s.put("cc", cc); s.put("city", c.get(0)); s.put("lat", c.get(1)); s.put("lng", c.get(2)); s.put("tz", c.get(3)); s.put("placeSet", true);
                    s.put("method", Prayer.defaultMethod(cc)); s.put("hanafi", Prayer.defaultHanafi(cc));
                } else { s.put("cc", ""); s.put("city", ""); }
                apply(); return;
            }
            if (src == city && city.getSelectedItem() != null) {
                for (Object c : Json.arr(CITIES.get(ST.str("cc")))) {
                    List<Object> cc = Json.arr(c);
                    if (Json.str(cc.get(0)).equals(city.getSelectedItem())) { s.put("city", cc.get(0)); s.put("lat", cc.get(1)); s.put("lng", cc.get(2)); s.put("tz", cc.get(3)); s.put("placeSet", true); apply(); return; }
                }
            }
            s.put("lat", ((Number) lat.getValue()).doubleValue()); s.put("lng", ((Number) lng.getValue()).doubleValue()); s.put("tz", String.valueOf(tz.getSelectedItem()));
            s.put("method", methodIds.get(Math.max(0, method.getSelectedIndex()))); s.put("hanafi", asr.getSelectedIndex() == 1);
            s.put("highLat", new String[]{"angle", "seventh", "middle"}[Math.max(0, hl.getSelectedIndex())]);
            s.put("hijriAdjust", (long) (hj.getSelectedIndex() - 2)); s.put("time24", clock.getSelectedIndex() == 1); s.put("sound", sound.getSelectedIndex() == 1 ? "none" : "chime");
            Map<String, Object> a = new LinkedHashMap<>(), r = new LinkedHashMap<>();
            for (int i = 0; i < 6; i++) {
                a.put(Prayer.PRAYERS[i], ((Number) adj[i].getValue()).longValue());
                Map<String, Object> one = new LinkedHashMap<>(); one.put("on", remOn[i].isSelected()); one.put("before", ((Number) remMin[i].getValue()).longValue()); r.put(Prayer.PRAYERS[i], one);
            }
            s.put("adjust", a); s.put("remind", r);
            if (src == lat || src == lng) { s.put("placeSet", true); s.put("cc", ""); s.put("city", ""); }
            apply();
        }

        private void apply() { ST.save(); loading = true; loadForm(); loading = false; refresh(); }

        private Prayer.Day today() {
            int[] c = Prayer.civil(System.currentTimeMillis(), ST.str("tz"));
            return Prayer.day(c[0], c[1], c[2], ST.dbl("lat"), ST.dbl("lng"), ST.str("tz"), ST.opts());
        }

        void refresh() {
            Prayer.Day td = today();
            long now = System.currentTimeMillis();
            long[] nx = Prayer.next(now, ST.dbl("lat"), ST.dbl("lng"), ST.str("tz"), ST.opts());
            nextAt = nx[1];
            place.setText("<html>" + (ST.str("city").isEmpty() ? t("mus.custom") : ST.str("city")) + (ST.str("cc").isEmpty() ? "" : " · " + countryName(ST.str("cc"))) + "</html>");
            ZonedDateTime z = Instant.ofEpochMilli(now).atZone(ZoneId.of(ST.str("tz")));
            Locale loc = I18n.rtl() ? new Locale("ar") : Locale.ENGLISH;
            date.setText("<html>" + z.getDayOfWeek().getDisplayName(TextStyle.FULL, loc) + " " + z.getDayOfMonth() + " " + z.getMonth().getDisplayName(TextStyle.FULL, loc) + " " + z.getYear() + " · " + hijri(td) + "</html>");
            next.setText("<html>" + t("mus.next") + "  <b>" + pname((int) nx[0]) + "</b>  " + fmtTime(nx[1]) + "</html>");
            double[] q = Prayer.qibla(ST.dbl("lat"), ST.dbl("lng"));
            dial.deg = q[0]; dial.repaint();
            qibla.setText(t("mus.qibla") + ": " + Math.round(q[0]) + "° · " + String.format("%,d", Math.round(q[1])) + " km");
            warn.setVisible(!ST.bool("placeSet"));
            boolean cut = false;
            for (Long a : td.at) if (a == null) cut = true;
            polar.setVisible(cut);
            if (!monthly) {
                model.setDataVector(new Object[0][0], new Object[]{"", "", ""});
                for (int i = 0; i < 6; i++) model.addRow(new Object[]{(i == nx[0] ? "▶ " : "") + pname(i), fmtTime(td.at[i]), Boolean.TRUE.equals(ST.remind(Prayer.PRAYERS[i]).get("on")) ? "🔔" : "🔕"});
                table.getTableHeader().setVisible(false); table.getTableHeader().setPreferredSize(new Dimension(0, 0));
            } else {
                Object[] heads = new Object[7]; heads[0] = "#";
                for (int i = 0; i < 6; i++) heads[i + 1] = pname(i);
                model.setDataVector(new Object[0][0], heads);
                int days = LocalDate.of(td.y, td.m, 1).lengthOfMonth();
                for (int d = 1; d <= days; d++) {
                    Prayer.Day x = Prayer.day(td.y, td.m, d, ST.dbl("lat"), ST.dbl("lng"), ST.str("tz"), ST.opts());
                    Object[] row = new Object[7]; row[0] = (d == td.d ? "▶ " : "") + d;
                    for (int i = 0; i < 6; i++) row[i + 1] = fmtTime(x.at[i]);
                    model.addRow(row);
                }
                table.getTableHeader().setVisible(true); table.getTableHeader().setPreferredSize(null);
            }
            table.revalidate();
        }

        private void bell(int row, int col) {
            if (monthly || col != 2 || row < 0 || row > 5) return;
            Map<String, Object> r = ST.remind(Prayer.PRAYERS[row]);
            r.put("on", !Boolean.TRUE.equals(r.get("on")));
            apply();
        }

        private void tick() {
            long left = Math.max(0, (nextAt - System.currentTimeMillis()) / 1000);
            cd.setText(String.format("%02d:%02d:%02d", left / 3600, left % 3600 / 60, left % 60));
            if (left == 0) refresh();
            Prayer.Day td = today();
            long now = System.currentTimeMillis();
            for (int i = 0; i < 6; i++) {
                Map<String, Object> r = ST.remind(Prayer.PRAYERS[i]);
                Long at = td.at[i];
                if (!Boolean.TRUE.equals(r.get("on")) || at == null) continue;
                int before = ((Number) r.get("before")).intValue();
                long target = at - before * 60000L;
                String key = td.y + "-" + td.m + "-" + td.d + "|" + i + "|" + before;
                if (target <= now && now < target + 120000 && fired.add(key)) fire(i, before);
            }
        }

        private void fire(int i, int before) {
            String msg = before > 0 ? t("mus.remind.in", "name", pname(i), "n", String.valueOf(before)) : t("mus.remind.now", "name", pname(i));
            if (!"none".equals(ST.str("sound"))) {
                new Thread(() -> { for (int k = 0; k < 3; k++) { java.awt.Toolkit.getDefaultToolkit().beep(); try { Thread.sleep(350); } catch (InterruptedException e) { return; } } }).start();
            }
            JDialog d = new JDialog((java.awt.Frame) javax.swing.SwingUtilities.getWindowAncestor(this), t("module.muslim"), false);
            JPanel p = new JPanel(new BorderLayout(0, 10)); p.setBorder(BorderFactory.createEmptyBorder(18, 22, 18, 22));
            JLabel l = Ui.label(msg, "title"); p.add(l);
            p.add(Ui.button("OK", d::dispose, null), BorderLayout.SOUTH);
            d.setContentPane(p); d.applyComponentOrientation(I18n.rtl() ? ComponentOrientation.RIGHT_TO_LEFT : ComponentOrientation.LEFT_TO_RIGHT);
            d.pack(); d.setLocationRelativeTo(this); d.setAlwaysOnTop(true); d.setVisible(true);
            new Timer(120000, e -> d.dispose()) {{ setRepeats(false); }}.start();
        }
    }

    // ------------------------------------------------------------------ Mushaf reader
    private static final File CACHE = new File(System.getProperty("user.home"), ".workflow-erp/mushaf");

    private static final class Reader extends JPanel {
        private final JButton nextB = new JButton("❮"), prevB = new JButton("❯"), minus = new JButton("−"), plus = new JButton("+"), fit = new JButton("⤢"), full = new JButton("⛶");
        private final javax.swing.JToggleButton two = new javax.swing.JToggleButton("▯▯"), mode = new javax.swing.JToggleButton("Aa"), night = new javax.swing.JToggleButton("☾"), theme = new javax.swing.JToggleButton("🎨"), star = new javax.swing.JToggleButton("★");
        private final JSpinner pageSp = new JSpinner(new SpinnerNumberModel(1, 1, PAGES, 1));
        private final JLabel where = new JLabel(), zoomL = new JLabel("100%");
        private final JComboBox<String> juz = new JComboBox<>(), marks = new JComboBox<>();
        private final JPanel stage = new JPanel(new FlowLayout(FlowLayout.CENTER, 6, 8));
        private final JScrollPane area = new JScrollPane(stage);
        private final JTextField base = new JTextField(String.valueOf(ST.s.get("mbase")));
        private final Map<Integer, BufferedImage> pix = new HashMap<>();
        private final java.util.Set<Integer> failed = new java.util.HashSet<>(), loading = new java.util.HashSet<>();
        private boolean busy;
        final Runnable onPage;

        Reader(Runnable onPage) {
            super(new BorderLayout(0, 6));
            this.onPage = onPage;
            setComponentOrientation(ComponentOrientation.LEFT_TO_RIGHT);
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEADING, 4, 2)); bar.setComponentOrientation(ComponentOrientation.LEFT_TO_RIGHT);
            for (int j = 1; j <= 30; j++) juz.addItem(t("mus.q.juz") + " " + j);
            where.setFont(where.getFont().deriveFont(16f));
            nextB.setToolTipText(t("mus.q.next")); prevB.setToolTipText(t("mus.q.prev"));
            for (java.awt.Component c : new java.awt.Component[]{nextB, new JLabel(t("mus.q.page")), pageSp, new JLabel("/ " + PAGES), prevB, where, juz, minus, zoomL, plus, fit, two, mode, theme, night, star, marks, full}) bar.add(c);
            add(bar, BorderLayout.NORTH);
            stage.setComponentOrientation(ComponentOrientation.LEFT_TO_RIGHT);
            area.getVerticalScrollBar().setUnitIncrement(24);
            add(area, BorderLayout.CENTER);
            JPanel src = new JPanel(new BorderLayout(6, 0));
            src.add(new JLabel(t("mus.q.source")), BorderLayout.LINE_START); src.add(base); src.add(Ui.button(t("mus.q.apply"), this::applyBase, null), BorderLayout.LINE_END);
            add(src, BorderLayout.SOUTH);

            nextB.addActionListener(e -> go(page() + step())); prevB.addActionListener(e -> go(page() - step()));
            pageSp.addChangeListener(e -> { if (!busy) go(((Number) pageSp.getValue()).intValue()); });
            juz.addActionListener(e -> { if (!busy && juz.getSelectedIndex() >= 0) go(JUZ_START[juz.getSelectedIndex()]); });
            minus.addActionListener(e -> zoom(-10)); plus.addActionListener(e -> zoom(10));
            fit.addActionListener(e -> { ST.s.put("mzoom", 100L); ST.save(); render(); });
            two.addActionListener(e -> { ST.s.put("mtwo", two.isSelected()); ST.save(); render(); });
            mode.addActionListener(e -> { ST.s.put("mmode", mode.isSelected() ? "text" : "img"); ST.save(); render(); });
            night.addActionListener(e -> { ST.s.put("mnight", night.isSelected()); ST.save(); render(); });
            theme.addActionListener(e -> { ST.s.put("mtheme", theme.isSelected() ? "blue" : "rose"); ST.save(); render(); });
            star.addActionListener(e -> toggleMark());
            marks.addActionListener(e -> { if (!busy && marks.getSelectedIndex() > 0) go(((Number) ST.marks().get(marks.getSelectedIndex() - 1)).intValue()); });
            full.addActionListener(e -> {
                java.awt.Window w = javax.swing.SwingUtilities.getWindowAncestor(this);
                if (w instanceof java.awt.Frame) { java.awt.Frame f = (java.awt.Frame) w; f.dispose(); f.setUndecorated(!f.isUndecorated()); f.setExtendedState(f.isUndecorated() ? java.awt.Frame.MAXIMIZED_BOTH : java.awt.Frame.NORMAL); f.setVisible(true); }
            });
            area.getViewport().addComponentListener(new java.awt.event.ComponentAdapter() { @Override public void componentResized(java.awt.event.ComponentEvent e) { layoutPages(); } });
            getInputMap(WHEN_IN_FOCUSED_WINDOW).put(KeyStroke.getKeyStroke("LEFT"), "nx");
            getInputMap(WHEN_IN_FOCUSED_WINDOW).put(KeyStroke.getKeyStroke("RIGHT"), "pv");
            getActionMap().put("nx", new javax.swing.AbstractAction() { public void actionPerformed(java.awt.event.ActionEvent e) { if (!(java.awt.KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusOwner() instanceof javax.swing.text.JTextComponent)) go(page() + step()); } });
            getActionMap().put("pv", new javax.swing.AbstractAction() { public void actionPerformed(java.awt.event.ActionEvent e) { if (!(java.awt.KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusOwner() instanceof javax.swing.text.JTextComponent)) go(page() - step()); } });
            render();
        }

        int page() { return clampPage(ST.num("mpage")); }
        boolean isTwo() { return ST.bool("mtwo") && area.getViewport().getWidth() >= 760; }
        int step() { return isTwo() ? 2 : 1; }

        void go(int p) { failed.clear(); ST.s.put("mpage", (long) clampPage(p)); ST.save(); render(); area.getVerticalScrollBar().setValue(0); }
        void zoom(int d) { ST.s.put("mzoom", (long) Math.min(220, Math.max(50, ST.num("mzoom") + d))); ST.save(); render(); }
        void applyBase() { ST.s.put("mbase", base.getText().trim()); ST.save(); pix.clear(); failed.clear(); render(); }

        List<Integer> shown() {
            int p = page();
            List<Integer> l = new ArrayList<>();
            if (!isTwo()) { l.add(p); return l; }
            int o = p % 2 == 1 ? p : p - 1;
            for (int x : new int[]{o, o + 1}) if (x >= 1 && x <= PAGES) l.add(x);
            return l;
        }

        int widthPx() {
            int avail = Math.max(240, area.getViewport().getWidth() - 40);
            double b = isTwo() ? Math.min(560, (avail - 6) / 2.0) : Math.min(640, avail);
            return (int) (b * ST.num("mzoom") / 100.0);
        }

        BufferedImage fetch(int p) throws Exception {
            String b = ST.str("mbase").isEmpty() ? Json.str(MF.get("base")) : ST.str("mbase");
            String name = String.format("%03d.png", p);
            if (b.toLowerCase().startsWith("http")) {
                File f = new File(CACHE, Integer.toHexString(b.hashCode()) + File.separator + name);
                if (f.exists()) return ImageIO.read(f);
                URLConnection c = new URL(b.replaceAll("/+$", "") + "/" + name).openConnection();
                c.setRequestProperty("User-Agent", "WorkflowErp-Desktop"); c.setConnectTimeout(15000); c.setReadTimeout(30000);
                byte[] data;
                try (InputStream in = c.getInputStream()) { data = in.readAllBytes(); }
                f.getParentFile().mkdirs(); Files.write(f.toPath(), data);
                return ImageIO.read(new java.io.ByteArrayInputStream(data));
            }
            return ImageIO.read(new File(b, name));
        }

        void render() {
            busy = true;
            int p = page();
            pageSp.setValue(p);
            where.setText("سورة " + surahName(surahOfPage(p)) + " · " + t("mus.q.juz") + " " + juzOfPage(p));
            juz.setSelectedIndex(juzOfPage(p) - 1);
            zoomL.setText(ST.num("mzoom") + "%");
            two.setSelected(ST.bool("mtwo")); night.setSelected(ST.bool("mnight"));
            theme.setSelected("blue".equals(String.valueOf(ST.s.get("mtheme")))); theme.setVisible("text".equals(String.valueOf(ST.s.get("mmode")))); theme.setToolTipText(t("mus.q.theme"));
            mode.setSelected("text".equals(String.valueOf(ST.s.get("mmode")))); mode.setToolTipText(t(mode.isSelected() ? "mus.q.imgmode" : "mus.q.textmode")); star.setSelected(ST.marks().contains((long) p) || ST.marks().contains(p));
            marks.removeAllItems();
            marks.addItem("★ " + ST.marks().size());
            for (Object m : ST.marks()) { int n = ((Number) m).intValue(); marks.addItem(t("mus.q.page") + " " + n + " · " + surahName(surahOfPage(n))); }
            marks.setVisible(!ST.marks().isEmpty());
            nextB.setEnabled(p + step() <= PAGES); prevB.setEnabled(p - step() >= 1);
            area.getViewport().setBackground(ST.bool("mnight") ? new Color(0x0D, 0x0D, 0x0D) : new Color(0xE5, 0xE9, 0xF0));
            busy = false;
            for (int q : shown()) load(q, false);
            for (int q : new int[]{p + 1, p + 2, p - 1}) if (q >= 1 && q <= PAGES) load(q, true);
            layoutPages();
            if (onPage != null) onPage.run();
        }

        void load(int p, boolean quiet) {
            if (pix.containsKey(p) || failed.contains(p) || !loading.add(p)) return;
            Ui.async(() -> { try { return fetch(p); } catch (Exception e) { throw new IllegalStateException(e); } }, img -> {
                loading.remove(p);
                if (img != null) { pix.put(p, img); if (pix.size() > 12) pix.keySet().removeIf(k -> k != p && !shown().contains(k) && pix.size() > 8); }
                else if (!quiet) failed.add(p);
                if (shown().contains(p)) layoutPages();
            }, m -> { loading.remove(p); if (!quiet) { failed.add(p); layoutPages(); } });
        }

        void layoutPages() {
            stage.removeAll();
            int w = widthPx(), h = (int) (w * 4206.0 / 2600);
            boolean nt = ST.bool("mnight");
            List<Integer> l = shown();
            l.sort((a, b) -> b - a); // left to right: the later (even) page, then the odd page on the right
            for (int p : l) {
                final boolean textMode = "text".equals(String.valueOf(ST.s.get("mmode")));
                final List<MushafText.Hit> hits = new ArrayList<>();
                BufferedImage img = textMode ? MushafText.render(p, w, nt, String.valueOf(ST.s.get("mtheme")), hits) : pix.get(p);
                final boolean err = !textMode && failed.contains(p);
                JComponent c = new JComponent() {
                    @Override protected void paintComponent(Graphics g0) {
                        Graphics2D g = (Graphics2D) g0.create();
                        g.setColor(nt ? Color.BLACK : Color.WHITE); g.fillRect(0, 0, getWidth(), getHeight());
                        if (img != null) {
                            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
                            BufferedImage out = textMode ? img : scaled(img, getWidth(), getHeight(), nt);
                            g.drawImage(out, 0, 0, null);
                        } else {
                            g.setColor(nt ? Color.LIGHT_GRAY : Color.DARK_GRAY);
                            String s = err ? t("mus.q.imgerr") : t("mus.loading");
                            java.awt.FontMetrics fm = g.getFontMetrics();
                            if (err) {
                                int y = 40;
                                for (String line : wrap(s, fm, getWidth() - 40)) { g.drawString(line, 20, y); y += fm.getHeight(); }
                            } else g.drawString(s, (getWidth() - fm.stringWidth(s)) / 2, getHeight() / 2);
                        }
                        g.dispose();
                    }
                };
                c.setPreferredSize(new Dimension(w, h));
                if (textMode) {
                    final int pg = p;
                    c.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.HAND_CURSOR));
                    c.addMouseListener(new java.awt.event.MouseAdapter() {
                        @Override public void mousePressed(java.awt.event.MouseEvent e) {
                            for (MushafText.Hit ht : hits) if (ht.r.contains(e.getX(), e.getY())) { new WordDialog(javax.swing.SwingUtilities.getWindowAncestor(c), pg, ht.li, ht.ti, ht.word).setVisible(true); return; }
                        }
                    });
                }
                stage.add(c);
            }
            stage.setPreferredSize(null);
            stage.revalidate(); stage.repaint();
        }

        private final Map<String, BufferedImage> scaledCache = new HashMap<>();

        private BufferedImage scaled(BufferedImage src, int w, int h, boolean invert) {
            String key = System.identityHashCode(src) + ":" + w + ":" + invert;
            BufferedImage c = scaledCache.get(key);
            if (c != null) return c;
            if (scaledCache.size() > 6) scaledCache.clear();
            BufferedImage cur = src;
            int tw = w, th = h;
            // halve step by step for a smooth result on big images
            while (cur.getWidth() / 2 > tw) {
                BufferedImage n = new BufferedImage(cur.getWidth() / 2, cur.getHeight() / 2, BufferedImage.TYPE_INT_RGB);
                Graphics2D g = n.createGraphics(); g.setColor(Color.WHITE); g.fillRect(0, 0, n.getWidth(), n.getHeight()); g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                g.drawImage(cur, 0, 0, n.getWidth(), n.getHeight(), null); g.dispose(); cur = n;
            }
            BufferedImage out = new BufferedImage(tw, th, BufferedImage.TYPE_INT_RGB);
            Graphics2D g = out.createGraphics(); g.setColor(Color.WHITE); g.fillRect(0, 0, tw, th); g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g.drawImage(cur, 0, 0, tw, th, null); g.dispose();
            if (invert) new RescaleOp(new float[]{-1f, -1f, -1f}, new float[]{255f, 255f, 255f}, null).filter(out, out);
            scaledCache.put(key, out);
            return out;
        }

        private static List<String> wrap(String s, java.awt.FontMetrics fm, int width) {
            List<String> out = new ArrayList<>();
            StringBuilder cur = new StringBuilder();
            for (String word : s.split(" ")) {
                if (cur.length() > 0 && fm.stringWidth(cur + " " + word) > width) { out.add(cur.toString()); cur.setLength(0); }
                if (cur.length() > 0) cur.append(' ');
                cur.append(word);
            }
            out.add(cur.toString());
            return out;
        }

        void toggleMark() {
            long p = page();
            List<Object> m = ST.marks();
            if (!m.remove((Object) p)) m.add(p);
            m.sort((a, b) -> Long.compare(((Number) a).longValue(), ((Number) b).longValue()));
            ST.s.put("pmarks", m); ST.save(); render();
        }
    }

    private static final class QuranTab extends JPanel {
        private final DefaultListModel<String> model = new DefaultListModel<>();
        private final JList<String> list = new JList<>(model);
        private final Reader reader;
        private boolean sync;

        QuranTab() {
            super(new BorderLayout(10, 0));
            for (int i = 1; i <= SURAH_AR.size(); i++) model.addElement(i + "   " + surahName(i));
            list.setFixedCellHeight(24);
            JScrollPane sp = new JScrollPane(list); sp.setPreferredSize(new Dimension(220, 0));
            reader = new Reader(this::syncList);
            add(sp, BorderLayout.LINE_START); add(reader);
            list.addListSelectionListener(e -> { if (!e.getValueIsAdjusting() && !sync && list.getSelectedIndex() >= 0) reader.go(SURAH_START[list.getSelectedIndex()]); });
            syncList();
        }

        private void syncList() { sync = true; int i = surahOfPage(reader == null ? clampPage(ST.num("mpage")) : reader.page()) - 1; list.setSelectedIndex(i); list.ensureIndexIsVisible(i); sync = false; }
    }
}
