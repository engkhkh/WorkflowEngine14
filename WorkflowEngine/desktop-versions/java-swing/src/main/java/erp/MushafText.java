package erp;

import java.awt.*;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** The Madinah Mushaf drawn as text (ornate frame, surah / juz header, 15 justified lines, verse medallions) - the same look as the portal's text pages.
 *  Data: mushaf-text.json (per page: ["H", surah] banner, ["B"] basmala, ["L", tokens] where a token is a word, a verse number or "*"). Font: Amiri Quran (SIL OFL, OFL.txt). */
final class MushafText {
    private static List<Object> pages;
    private static Font base;
    private static final Pattern STRIP = Pattern.compile("[ً-ٰٟۖ-ۭـ]");
    private static final Pattern RED = Pattern.compile("^[وفبتك]?(?:الله|لله|رب(?:نا|كم|هم|ك|ي|ه|ها|هما|كما|هن)?)$");

    private MushafText() {}

    private static synchronized List<Object> pages() {
        if (pages == null) {
            try (InputStream in = MushafText.class.getResourceAsStream("/mushaf-text.json")) {
                pages = Json.arr(Json.parse(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)));
            } catch (Exception e) { throw new RuntimeException(e); }
        }
        return pages;
    }

    private static synchronized Font font(double px) {
        if (base == null) {
            try (InputStream in = MushafText.class.getResourceAsStream("/AmiriQuran-Regular.ttf")) {
                base = Font.createFont(Font.TRUETYPE_FONT, in);
            } catch (Exception e) { base = new Font("Serif", Font.PLAIN, 12); }
        }
        return base.deriveFont((float) Math.max(4, Math.round(px)));
    }

    static String arNum(int n) {
        StringBuilder b = new StringBuilder();
        for (char c : String.valueOf(n).toCharArray()) b.append((char) (0x0660 + (c - '0')));
        return b.toString();
    }

    static boolean isRed(String w) { return RED.matcher(STRIP.matcher(w).replaceAll("").replace('ٱ', 'ا')).matches(); }

    /** page colours: rose (default) or blue; the Madinah text itself is always black with Allah / Rabb in red */
    private static final class Pal {
        final Color bg, band, line, orn, edge, cfill, ctext, num, hfill, mstroke, mfill; final boolean hearts;
        Pal(int bg, int band, int line, int orn, int edge, int cfill, int ctext, int num, int hfill, int mstroke, int mfill, boolean hearts) {
            this.bg = new Color(bg); this.band = new Color(band); this.line = new Color(line); this.orn = new Color(orn); this.edge = new Color(edge); this.cfill = new Color(cfill);
            this.ctext = new Color(ctext); this.num = new Color(num); this.hfill = new Color(hfill); this.mstroke = new Color(mstroke); this.mfill = new Color(mfill); this.hearts = hearts;
        }
    }
    private static final Pal ROSE = new Pal(0xFFFDF6, 0xF2C6D6, 0x7A1F4B, 0xC2185B, 0x9A2F63, 0xFBE4EE, 0x4A1030, 0x6B2A4A, 0xF6D3E1, 0x8A3A63, 0xFBE3EC, true);
    private static final Pal BLUE = new Pal(0xF5F9FF, 0xB9D3F3, 0x1B4A86, 0x1565C0, 0x2F6DB5, 0xE1EEFF, 0x0C2A55, 0x1D3D6B, 0xCDE1FB, 0x2A63AD, 0xE4EFFF, false);
    private static Pal pal = ROSE;

    private static final class Item { char kind; String text; int num; double w; int ti; }

    /** where a word was painted, so a tap can be mapped to it (line index, token index in that line) */
    static final class Hit { final java.awt.geom.Rectangle2D r; final int li, ti; final String word; Hit(java.awt.geom.Rectangle2D r, int li, int ti, String word) { this.r = r; this.li = li; this.ti = ti; this.word = word; } }
    /** a token's verse: surah, verse, word number (from 1) and the number of words in that verse */
    static final class Loc { final int surah, ayah, pos, total; Loc(int s, int a, int p, int t) { surah = s; ayah = a; pos = p; total = t; } }
    private static Map<String, Object> index;

    static String surahName(int surah) { return Json.str(Json.arr(Json.obj(Prayer.SPEC.get("mushaf")).get("surahAr")).get(surah - 1)); }

    @SuppressWarnings("unchecked")
    static synchronized Loc locate(int page, int li, int ti) {
        if (index == null) {
            try (InputStream in = MushafText.class.getResourceAsStream("/mushaf-index.json")) {
                index = Json.obj(Json.parse(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)));
            } catch (Exception e) { throw new RuntimeException(e); }
        }
        List<Object> st = Json.arr(Json.arr(index.get("start")).get(page - 1));
        int surah = ((Number) st.get(0)).intValue(), ayah = ((Number) st.get(1)).intValue(), wi = ((Number) st.get(2)).intValue();
        Map<String, Object> cnt = Json.obj(index.get("count"));
        List<Object> lines = Json.arr(pages().get(page - 1));
        for (int i = 0; i <= li && i < lines.size(); i++) {
            List<Object> ln = Json.arr(lines.get(i));
            String k = String.valueOf(ln.get(0));
            if (k.equals("H")) { surah = ((Number) ln.get(1)).intValue(); ayah = 1; wi = 0; continue; }
            if (!k.equals("L")) continue;
            List<Object> toks = Json.arr(ln.get(1));
            for (int j = 0; j < toks.size(); j++) {
                if (i == li && j == ti) { Object c = cnt.get(surah + ":" + ayah); return new Loc(surah, ayah, wi + 1, c instanceof Number ? ((Number) c).intValue() : 0); }
                Object v = toks.get(j);
                if ("*".equals(v)) continue;
                if (v instanceof Number) { ayah = ((Number) v).intValue() + 1; wi = 0; } else wi++;
            }
        }
        return new Loc(surah, ayah, wi + 1, 0);
    }

    /** text centred in the box on a baseline from the font metrics */
    private static void center(Graphics2D g, double x, double y, double w, double h, String t) {
        FontMetrics fm = g.getFontMetrics();
        double tw = fm.stringWidth(t);
        g.drawString(t, (float) (x + w / 2 - tw / 2), (float) (y + h / 2 + (fm.getAscent() - fm.getDescent()) / 2.0 - g.getFont().getSize2D() * .05));
    }

    private static void cartouche(Graphics2D g, double x, double y, double w, double h, String t, double u) {
        RoundRectangle2D r = new RoundRectangle2D.Double(x, y, w, h, 2.4 * u, 2.4 * u);
        g.setColor(pal.cfill); g.fill(r);
        g.setColor(pal.edge); g.setStroke(new BasicStroke((float) (.35 * u))); g.draw(r);
        g.setColor(pal.ctext); g.setFont(font(3.5 * u));
        center(g, x, y, w, h, t);
    }

    private static void heart(Graphics2D g, double cx, double cy, double u) {
        double r = .72 * u;
        if (!pal.hearts) { Path2D.Double dm = new Path2D.Double(); dm.moveTo(cx, cy - r * 1.05); dm.lineTo(cx + r * .8, cy); dm.lineTo(cx, cy + r * 1.05); dm.lineTo(cx - r * .8, cy); dm.closePath(); g.fill(dm); return; }
        g.fill(new Ellipse2D.Double(cx - r * .5 - r * .55, cy - r * .25 - r * .55, r * 1.1, r * 1.1));
        g.fill(new Ellipse2D.Double(cx + r * .5 - r * .55, cy - r * .25 - r * .55, r * 1.1, r * 1.1));
        Path2D.Double t = new Path2D.Double();
        t.moveTo(cx - r * 1.02, cy - r * .05); t.lineTo(cx + r * 1.02, cy - r * .05); t.lineTo(cx, cy + r * 1.1); t.closePath();
        g.fill(t);
    }

    static BufferedImage render(int page, int width, boolean night) { return render(page, width, night, "rose"); }

    static synchronized BufferedImage render(int page, int width, boolean night, String theme) { return render(page, width, night, theme, null); }

    static synchronized BufferedImage render(int page, int width, boolean night, String theme, List<Hit> hits) {
        if (hits != null) hits.clear();
        pal = "blue".equals(theme) ? BLUE : ROSE;
        int H = (int) (width * 4206.0 / 2600);
        BufferedImage img = new BufferedImage(width, H, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
        g.setColor(pal.bg); g.fillRect(0, 0, width, H);
        double u = width / 100.0, W = width;
        Map<String, Object> mf = Json.obj(Prayer.SPEC.get("mushaf"));
        List<Object> surahAr = Json.arr(mf.get("surahAr")), juzAr = Json.arr(mf.get("juzAr"));
        double fo = 1.4 * u, bw = 3.4 * u;
        double ox = fo, oy = fo, ow = W - 2 * fo, oh = H - 2 * fo;
        g.setColor(pal.band); g.fill(new java.awt.geom.Rectangle2D.Double(ox, oy, ow, oh));
        double ix = ox + bw, iy = oy + bw, iw = ow - 2 * bw, ih = oh - 2 * bw;
        g.setColor(pal.bg); g.fill(new java.awt.geom.Rectangle2D.Double(ix, iy, iw, ih));
        g.setColor(pal.line);
        g.setStroke(new BasicStroke((float) (.5 * u))); g.draw(new java.awt.geom.Rectangle2D.Double(ox + .25 * u, oy + .25 * u, ow - .5 * u, oh - .5 * u));
        g.setStroke(new BasicStroke((float) (.4 * u))); g.draw(new java.awt.geom.Rectangle2D.Double(ix, iy, iw, ih));
        g.setColor(pal.orn);
        double mid = bw / 2, step = 4.2 * u;
        for (double x = ox + bw + step / 2; x < ox + ow - bw - step / 4; x += step) { heart(g, x, oy + mid, u); heart(g, x, oy + oh - mid, u); }
        for (double y = oy + bw + step / 2; y < oy + oh - bw - step / 4; y += step) { heart(g, ox + mid, y, u); heart(g, ox + ow - mid, y, u); }
        g.setColor(Color.WHITE);
        for (double[] c : new double[][]{{ox + mid, oy + mid}, {ox + ow - mid, oy + mid}, {ox + mid, oy + oh - mid}, {ox + ow - mid, oy + oh - mid}})
            g.fill(new Ellipse2D.Double(c[0] - 1.25 * u, c[1] - 1.25 * u, 2.5 * u, 2.5 * u));
        double left = ix + 1.2 * u, right = ix + iw - 1.2 * u, top = iy + .4 * u, hh = 6.2 * u;
        g.setFont(font(3.5 * u));
        String jt = "الجزء " + Json.str(juzAr.get(Muslim.juzOfPage(page) - 1));
        String st = "سورة " + Json.str(surahAr.get(Muslim.surahOfPage(page) - 1));
        double jw = g.getFontMetrics().stringWidth(jt) + 4.8 * u, sw = g.getFontMetrics().stringWidth(st) + 4.8 * u;
        cartouche(g, right - jw, top + .7 * u, jw, hh - 1.4 * u, jt, u);
        cartouche(g, left, top + .7 * u, sw, hh - 1.4 * u, st, u);
        g.setColor(pal.num); g.setFont(font(3.2 * u));
        center(g, left, iy + ih - 4.8 * u, right - left, 4.4 * u, arNum(page));
        List<Object> data = Json.arr(pages().get(page - 1));
        double bodyTop = top + hh, bodyBot = iy + ih - 4.8 * u, row = (bodyBot - bodyTop) / 15, y0 = bodyTop + (15 - data.size()) * row / 2, W2 = right - left;
        for (int i = 0; i < data.size(); i++) {
            List<Object> ln = Json.arr(data.get(i));
            String kind = Json.str(ln.get(0));
            double ry = y0 + i * row;
            if (kind.equals("H")) {
                RoundRectangle2D r = new RoundRectangle2D.Double(left, ry + .5 * u, W2, row - 1.0 * u, 3.2 * u, 3.2 * u);
                g.setColor(pal.hfill); g.fill(r);
                g.setColor(pal.edge); g.setStroke(new BasicStroke((float) (.35 * u))); g.draw(r);
                g.setColor(pal.ctext); g.setFont(font(4.9 * u));
                center(g, left, ry + .5 * u, W2, row - 1.0 * u, "سُورَةُ " + Json.str(surahAr.get(((Number) ln.get(1)).intValue() - 1)));
            } else if (kind.equals("B")) {
                g.setColor(new Color(0x14110F)); g.setFont(font(4.9 * u));
                center(g, left, ry, W2, row, "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ");
            } else drawLine(g, Json.arr(ln.get(1)), left, ry, W2, row, 5.6 * u, hits, i);
        }
        g.dispose();
        if (night) {
            for (int y = 0; y < img.getHeight(); y++) for (int x = 0; x < img.getWidth(); x++) img.setRGB(x, y, ~img.getRGB(x, y) & 0xFFFFFF);
        }
        return img;
    }

    private static void drawLine(Graphics2D g, List<Object> toks, double left, double ry, double W, double row, double S, List<Hit> hits, int li) {
        double k = 1, fs = S, tot = 0, nat = 0;
        List<Item> items = new ArrayList<>();
        Font fnt = null, small = null;
        for (int pass = 0; pass < 2; pass++) {
            fs = S * k;
            fnt = font(fs); small = font(fs * .62);
            FontMetrics fm = g.getFontMetrics(fnt), fms = g.getFontMetrics(small);
            items.clear(); tot = 0;
            int tix = -1;
            for (Object v : toks) {
                Item it = new Item(); it.ti = ++tix;
                if (v instanceof Number) { it.kind = 'n'; it.num = ((Number) v).intValue(); it.w = fs * .74 * 1.45; }
                else if ("*".equals(v)) { it.kind = 'q'; it.w = fms.stringWidth("۞"); }
                else { it.kind = 'w'; it.text = (String) v; it.w = fm.stringWidth(it.text); }
                tot += it.w; items.add(it);
            }
            nat = tot + fs * .22 * Math.max(0, items.size() - 1);
            if (nat > W && pass == 0) { k = Math.max(.6, W / nat * .985); continue; }
            break;
        }
        int n = items.size();
        double gap, x;
        if (nat < W * .72) { gap = fs * .32; x = left + (W - (tot + gap * (n - 1))) / 2 + tot + gap * (n - 1); }
        else { gap = n > 1 ? (W - tot) / (n - 1) : 0; x = left + W; }
        FontMetrics fm = g.getFontMetrics(fnt);
        double cy = ry + row / 2, bl = cy + (fm.getAscent() - fm.getDescent()) / 2.0 - fs * .05;
        for (Item it : items) {
            x -= it.w;
            if (it.kind == 'w') { if (hits != null) hits.add(new Hit(new java.awt.geom.Rectangle2D.Double(x - gap / 2, ry, it.w + gap, row), li, it.ti, it.text)); g.setFont(fnt); g.setColor(isRed(it.text) ? new Color(0xC0143C) : new Color(0x14110F)); g.drawString(it.text, (float) x, (float) bl); }
            else if (it.kind == 'q') { g.setFont(small); g.setColor(pal.edge); g.drawString("۞", (float) x, (float) bl); }
            else {
                double d = fs * .74 * 1.45;
                Ellipse2D.Double e = new Ellipse2D.Double(x, cy - d / 2, d, d);
                g.setColor(pal.mfill); g.fill(e);
                g.setColor(pal.mstroke); g.setStroke(new BasicStroke((float) (fs * .045))); g.draw(e);
                g.setColor(pal.ctext); g.setFont(font(fs * .49));
                center(g, x, cy - d / 2, d, d, arNum(it.num));
            }
            x -= gap;
        }
    }
}
