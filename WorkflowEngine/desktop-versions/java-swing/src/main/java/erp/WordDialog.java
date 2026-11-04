package erp;

import java.awt.*;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.swing.*;

import static erp.I18n.t;

/**
 * Tap a word of the Quran text pages: meaning, verse translation and tafsir from the public Quran.com API.
 * Needs internet; the address can be changed with the environment variable QURAN_API.
 */
final class WordDialog extends JDialog {
    private final MushafText.Loc loc;
    private final JLabel meaning = new JLabel("…", SwingConstants.CENTER);
    private final JLabel verse = new JLabel();
    private final JTextArea tf = new JTextArea(7, 40);
    private final JScrollPane tfScroll = new JScrollPane(tf);
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    static String apiBase() {
        String e = System.getenv("QURAN_API");
        return e == null || e.isEmpty() ? "https://api.quran.com/api/v4" : e;
    }

    static String stripHtml(String h) {
        h = h == null ? "" : h.replaceAll("(?i)<br\\s*/?>|</p>", "\n").replaceAll("<[^>]+>", "");
        return h.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").trim();
    }

    private static Map<String, Object> get(String url) {
        try {
            HttpResponse<String> r = HTTP.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20)).header("Accept", "application/json")
                .header("User-Agent", "WorkflowErp-Desktop").build(), HttpResponse.BodyHandlers.ofString(java.nio.charset.StandardCharsets.UTF_8));
            if (r.statusCode() >= 400) throw new IllegalStateException("HTTP " + r.statusCode());
            return Json.obj(Json.parse(r.body()));
        } catch (IllegalStateException e) { throw e; }
        catch (Exception e) { throw new IllegalStateException(String.valueOf(e.getMessage())); }
    }

    WordDialog(Window owner, int page, int li, int ti, String word) {
        super(owner, t("mus.q.word"), ModalityType.APPLICATION_MODAL);
        loc = MushafText.locate(page, li, ti);
        setLayout(new BorderLayout(8, 8));
        JPanel top = new JPanel(); top.setLayout(new BoxLayout(top, BoxLayout.Y_AXIS)); top.setBorder(BorderFactory.createEmptyBorder(12, 14, 4, 14));
        JLabel wd = new JLabel(word, SwingConstants.CENTER); wd.setFont(wd.getFont().deriveFont(34f)); wd.setAlignmentX(0.5f);
        JLabel ref = new JLabel(MushafText.surahName(loc.surah) + " · " + loc.ayah, SwingConstants.CENTER); ref.setAlignmentX(0.5f);
        meaning.setFont(meaning.getFont().deriveFont(Font.BOLD, 16f)); meaning.setAlignmentX(0.5f);
        verse.setAlignmentX(0.5f);
        top.add(wd); top.add(ref); top.add(Box.createVerticalStrut(8)); top.add(meaning); top.add(Box.createVerticalStrut(8)); top.add(verse);
        add(top, BorderLayout.NORTH);
        tf.setEditable(false); tf.setLineWrap(true); tf.setWrapStyleWord(true);
        tfScroll.setVisible(false);
        JPanel mid = new JPanel(new BorderLayout(0, 6)); mid.setBorder(BorderFactory.createEmptyBorder(0, 14, 0, 14));
        JPanel row = new JPanel(new GridLayout(1, 2, 8, 0));
        JButton ar = new JButton("التفسير الميسر"), en = new JButton("Tafsir Ibn Kathir");
        ar.addActionListener(e -> showTafsir("ar")); en.addActionListener(e -> showTafsir("en"));
        row.add(ar); row.add(en);
        mid.add(row, BorderLayout.NORTH); mid.add(tfScroll, BorderLayout.CENTER);
        add(mid, BorderLayout.CENTER);
        JButton close = new JButton(t("common.close")); close.addActionListener(e -> dispose());
        JPanel bot = new JPanel(new FlowLayout(FlowLayout.CENTER)); bot.add(close);
        add(bot, BorderLayout.SOUTH);
        pack(); setMinimumSize(new Dimension(480, getHeight())); setLocationRelativeTo(owner);

        final String url = apiBase() + "/verses/by_key/" + loc.surah + ":" + loc.ayah + "?words=true&word_fields=transliteration&translations=20&language=en";
        Ui.async(() -> get(url), o -> {
            Map<String, Object> v = Json.obj(o.get("verse"));
            List<Object> words = new ArrayList<>();
            for (Object w : Json.arr(v.get("words"))) { Object ct = Json.obj(w).get("char_type_name"); if (ct == null || "word".equals(ct)) words.add(w); }
            String mean = "", tr = "";
            if (words.size() == loc.total && loc.pos > 0 && loc.pos <= words.size()) {
                Map<String, Object> w = Json.obj(words.get(loc.pos - 1));
                mean = Json.str(Json.obj(w.get("translation")).get("text")); tr = Json.str(Json.obj(w.get("transliteration")).get("text"));
            }
            meaning.setText(mean.isEmpty() ? t("mus.q.nomeaning") : mean + (tr.isEmpty() ? "" : "  ·  " + tr));
            List<Object> trs = Json.arr(v.get("translations"));
            verse.setText("<html><body style='width:380px'>" + (trs.isEmpty() ? "" : stripHtml(Json.str(Json.obj(trs.get(0)).get("text")))) + "</body></html>");
            pack();
        }, m -> meaning.setText("<html><center>" + t("mus.q.offline") + "<br>" + m + "</center></html>"));
    }

    void showTafsir(String lang) {
        tfScroll.setVisible(true);
        tf.setComponentOrientation("ar".equals(lang) ? ComponentOrientation.RIGHT_TO_LEFT : ComponentOrientation.LEFT_TO_RIGHT);
        tf.setText("…");
        final String url = apiBase() + "/tafsirs/" + ("ar".equals(lang) ? 16 : 169) + "/by_ayah/" + loc.surah + ":" + loc.ayah;
        Ui.async(() -> get(url), o -> { String s = stripHtml(Json.str(Json.obj(o.get("tafsir")).get("text"))); tf.setText(s.isEmpty() ? "-" : s); tf.setCaretPosition(0); pack(); },
            m -> tf.setText(t("mus.q.offline") + "\n" + m));
    }

    String meaningText() { return meaning.getText(); }
    String verseText() { return verse.getText(); }
    String tafsirText() { return tf.getText(); }
}
