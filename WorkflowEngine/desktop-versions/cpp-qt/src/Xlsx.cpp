#include "Xlsx.h"

#include <QFile>
#include <QRegularExpression>
#include <QXmlStreamReader>
#include <cstring>

namespace Xlsx {
namespace {
// ---- inflate (RFC 1951), after Mark Adler's "puff"
struct State {
    const uchar* in; int inLen, inPos = 0;
    uchar bitBuf = 0; int bitCnt = 0;
    QByteArray* out; int limit;
    bool err = false;
};
int bits(State& s, int need) {
    long val = s.bitBuf;
    while (s.bitCnt < need) {
        if (s.inPos >= s.inLen) { s.err = true; return 0; }
        val |= long(s.in[s.inPos++]) << s.bitCnt;
        s.bitCnt += 8;
    }
    s.bitBuf = uchar(val >> need);
    s.bitCnt -= need;
    return int(val & ((1L << need) - 1));
}
struct Huff { short count[16]; short symbol[288]; };
int decode(State& s, const Huff& h) {
    int code = 0, first = 0, index = 0;
    for (int len = 1; len <= 15; ++len) {
        code |= bits(s, 1);
        if (s.err) return -1;
        int count = h.count[len];
        if (code - count < first) return h.symbol[index + (code - first)];
        index += count; first += count; first <<= 1; code <<= 1;
    }
    return -1;
}
int construct(Huff& h, const short* length, int n) {
    for (int l = 0; l <= 15; ++l) h.count[l] = 0;
    for (int i = 0; i < n; ++i) h.count[length[i]]++;
    if (h.count[0] == n) return 0;
    int left = 1;
    for (int l = 1; l <= 15; ++l) { left <<= 1; left -= h.count[l]; if (left < 0) return left; }
    short offs[16]; offs[1] = 0;
    for (int l = 1; l < 15; ++l) offs[l + 1] = offs[l] + h.count[l];
    for (int i = 0; i < n; ++i) if (length[i] != 0) h.symbol[offs[length[i]]++] = short(i);
    return left;
}
const short kLens[29] = {3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258};
const short kLext[29] = {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
const short kDists[30] = {1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
const short kDext[30] = {0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};

bool codes(State& s, const Huff& lc, const Huff& dc) {
    for (;;) {
        int sym = decode(s, lc);
        if (sym < 0) return false;
        if (sym < 256) { s.out->append(char(sym)); }
        else if (sym == 256) return true;
        else {
            sym -= 257;
            if (sym >= 29) return false;
            int len = kLens[sym] + bits(s, kLext[sym]);
            int ds = decode(s, dc);
            if (ds < 0 || ds >= 30) return false;
            int dist = kDists[ds] + bits(s, kDext[ds]);
            if (s.err || dist > s.out->size()) return false;
            int start = s.out->size() - dist;
            for (int i = 0; i < len; ++i) s.out->append((*s.out)[start + i]);
        }
        if (s.err || s.out->size() > s.limit + 258) return false;
    }
}
}  // namespace

bool inflate(const QByteArray& in, int outSize, QByteArray& out) {
    State s;
    s.in = reinterpret_cast<const uchar*>(in.constData()); s.inLen = in.size(); s.out = &out; s.limit = outSize;
    out.clear(); out.reserve(outSize);
    int last;
    do {
        last = bits(s, 1);
        const int type = bits(s, 2);
        if (s.err) return false;
        if (type == 0) {
            s.bitBuf = 0; s.bitCnt = 0;
            if (s.inPos + 4 > s.inLen) return false;
            const int len = s.in[s.inPos] | (s.in[s.inPos + 1] << 8);
            s.inPos += 4;
            if (s.inPos + len > s.inLen) return false;
            out.append(reinterpret_cast<const char*>(s.in) + s.inPos, len);
            s.inPos += len;
        } else if (type == 1) {
            Huff lc, dc; short lengths[288];
            int sym = 0;
            for (; sym < 144; ++sym) lengths[sym] = 8;
            for (; sym < 256; ++sym) lengths[sym] = 9;
            for (; sym < 280; ++sym) lengths[sym] = 7;
            for (; sym < 288; ++sym) lengths[sym] = 8;
            construct(lc, lengths, 288);
            for (sym = 0; sym < 30; ++sym) lengths[sym] = 5;
            construct(dc, lengths, 30);
            if (!codes(s, lc, dc)) return false;
        } else if (type == 2) {
            static const short order[19] = {16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15};
            short lengths[320];
            const int nlen = bits(s, 5) + 257, ndist = bits(s, 5) + 1, ncode = bits(s, 4) + 4;
            if (s.err || nlen > 286 || ndist > 30) return false;
            int index;
            for (index = 0; index < ncode; ++index) lengths[order[index]] = short(bits(s, 3));
            for (; index < 19; ++index) lengths[order[index]] = 0;
            Huff lc, dc;
            if (construct(lc, lengths, 19) != 0) return false;
            index = 0;
            while (index < nlen + ndist) {
                int symbol = decode(s, lc);
                if (symbol < 0) return false;
                if (symbol < 16) lengths[index++] = short(symbol);
                else {
                    int len = 0, rep;
                    if (symbol == 16) { if (index == 0) return false; len = lengths[index - 1]; rep = 3 + bits(s, 2); }
                    else if (symbol == 17) rep = 3 + bits(s, 3);
                    else rep = 11 + bits(s, 7);
                    if (index + rep > nlen + ndist) return false;
                    while (rep--) lengths[index++] = short(len);
                }
            }
            if (lengths[256] == 0) return false;
            construct(lc, lengths, nlen);
            construct(dc, lengths + nlen, ndist);
            if (!codes(s, lc, dc)) return false;
        } else return false;
        if (s.err) return false;
    } while (!last);
    return true;
}

namespace {
quint32 u32(const QByteArray& b, int p) { return quint32(uchar(b[p])) | quint32(uchar(b[p + 1])) << 8 | quint32(uchar(b[p + 2])) << 16 | quint32(uchar(b[p + 3])) << 24; }
quint16 u16(const QByteArray& b, int p) { return quint16(uchar(b[p])) | quint16(uchar(b[p + 1])) << 8; }
struct Entry { QString name; int method, csize, usize, offset; };
QVector<Entry> directory(const QByteArray& z) {
    QVector<Entry> res;
    int eocd = -1;
    for (int p = z.size() - 22; p >= 0 && p >= z.size() - 70000; --p) if (u32(z, p) == 0x06054b50) { eocd = p; break; }
    if (eocd < 0) return res;
    int n = u16(z, eocd + 10), p = int(u32(z, eocd + 16));
    for (int i = 0; i < n && p + 46 <= z.size() && u32(z, p) == 0x02014b50; ++i) {
        Entry e;
        e.method = u16(z, p + 10); e.csize = int(u32(z, p + 20)); e.usize = int(u32(z, p + 24));
        const int nl = u16(z, p + 28), xl = u16(z, p + 30), cl = u16(z, p + 32);
        e.offset = int(u32(z, p + 42));
        e.name = QString::fromUtf8(z.mid(p + 46, nl));
        res.append(e);
        p += 46 + nl + xl + cl;
    }
    return res;
}
}  // namespace

QStringList zipNames(const QByteArray& zip) { QStringList l; for (const Entry& e : directory(zip)) l << e.name; return l; }

bool unzip(const QByteArray& zip, const QString& name, QByteArray& out) {
    for (const Entry& e : directory(zip)) {
        if (e.name != name) continue;
        const int lo = e.offset;
        if (lo + 30 > zip.size() || u32(zip, lo) != 0x04034b50) return false;
        const int data = lo + 30 + u16(zip, lo + 26) + u16(zip, lo + 28);
        const QByteArray raw = zip.mid(data, e.csize);
        if (e.method == 0) { out = raw; return true; }
        if (e.method == 8) return inflate(raw, e.usize, out);
        return false;
    }
    return false;
}

namespace {
int colIndex(const QString& ref) {
    int n = 0;
    for (QChar c : ref) { if (c.isLetter()) n = n * 26 + (c.toUpper().unicode() - 'A' + 1); else break; }
    return n - 1;
}
}

bool readXlsx(const QString& path, Table& rows) {
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly)) return false;
    const QByteArray zip = f.readAll();
    QStringList shared;
    QByteArray x;
    if (unzip(zip, "xl/sharedStrings.xml", x)) {
        QXmlStreamReader r(x);
        QString cur; bool inSi = false;
        while (!r.atEnd()) {
            r.readNext();
            if (r.isStartElement() && r.name() == u"si") { inSi = true; cur.clear(); }
            else if (r.isStartElement() && r.name() == u"t" && inSi) cur += r.readElementText();
            else if (r.isEndElement() && r.name() == u"si") { shared << cur; inSi = false; }
        }
    }
    QString sheet = "xl/worksheets/sheet1.xml";
    if (!zipNames(zip).contains(sheet)) {
        QStringList l; for (const QString& n : zipNames(zip)) if (n.startsWith("xl/worksheets/") && n.endsWith(".xml")) l << n;
        if (l.isEmpty()) return false;
        l.sort(); sheet = l.first();
    }
    if (!unzip(zip, sheet, x)) return false;
    QXmlStreamReader r(x);
    rows.clear();
    QVector<QVariant> row; int rowIdx = -1;
    QString ref, t; bool inV = false;
    while (!r.atEnd()) {
        r.readNext();
        if (r.isStartElement()) {
            if (r.name() == u"row") {
                row.clear();
                rowIdx = r.attributes().hasAttribute("r") ? r.attributes().value("r").toInt() - 1 : rows.size();
                while (rows.size() < rowIdx) rows.append(QVector<QVariant>());
            } else if (r.name() == u"c") {
                ref = r.attributes().value("r").toString(); t = r.attributes().value("t").toString();
                const int ci = colIndex(ref);
                while (row.size() < ci) row.append(QVariant());
                row.append(QVariant());
            } else if (r.name() == u"v") {
                const QString v = r.readElementText();
                QVariant val;
                if (t == "s") val = shared.value(v.toInt());
                else if (t == "str" || t == "e") val = v;
                else if (t == "b") val = v == "1" ? "TRUE" : "FALSE";
                else val = v.toDouble();
                if (!row.isEmpty()) row.last() = val;
                inV = false;
            } else if (r.name() == u"is") {
                QString s;
                while (!(r.isEndElement() && r.name() == u"is") && !r.atEnd()) { r.readNext(); if (r.isStartElement() && r.name() == u"t") s += r.readElementText(); }
                if (!row.isEmpty()) row.last() = s;
            }
        } else if (r.isEndElement() && r.name() == u"row") rows.append(row);
    }
    Q_UNUSED(inV)
    return !r.hasError();
}

Table parseCsv(const QString& textIn) {
    QString text = textIn;
    if (text.startsWith(QChar(0xFEFF))) text.remove(0, 1);
    const QString first = text.section('\n', 0, 0);
    QChar delim = ',';
    int best = 0;
    for (QChar d : {QChar(','), QChar(';'), QChar('\t')}) { const int n = first.count(d); if (n > best) { best = n; delim = d; } }
    Table rows; QVector<QVariant> row; QString cur; bool q = false;
    for (int i = 0; i < text.size(); ++i) {
        const QChar c = text[i];
        if (q) {
            if (c == '"') { if (i + 1 < text.size() && text[i + 1] == '"') { cur += '"'; ++i; } else q = false; }
            else cur += c;
        } else if (c == '"') q = true;
        else if (c == delim) { row.append(cur); cur.clear(); }
        else if (c == '\n' || c == '\r') {
            if (c == '\r' && i + 1 < text.size() && text[i + 1] == '\n') ++i;
            row.append(cur); rows.append(row); row.clear(); cur.clear();
        } else cur += c;
    }
    if (!cur.isEmpty() || !row.isEmpty()) { row.append(cur); rows.append(row); }
    return rows;
}

bool readTable(const QString& path, Table& rows, QString& err) {
    const QString low = path.toLower();
    if (low.endsWith(".xlsx")) { if (!readXlsx(path, rows)) { err = "read"; return false; } }
    else if (low.endsWith(".csv") || low.endsWith(".txt")) {
        QFile f(path);
        if (!f.open(QIODevice::ReadOnly)) { err = "read"; return false; }
        rows = parseCsv(QString::fromUtf8(f.readAll()));
    } else { err = "type"; return false; }
    Table kept;
    for (const auto& r : rows) {
        bool any = false;
        for (const QVariant& c : r) if (c.isValid() && !c.toString().trimmed().isEmpty()) { any = true; break; }
        if (any) kept.append(r);
    }
    rows = kept;
    return true;
}
}  // namespace Xlsx
