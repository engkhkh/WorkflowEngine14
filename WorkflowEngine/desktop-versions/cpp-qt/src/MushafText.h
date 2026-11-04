#pragma once
#include <QImage>
#include <QRectF>
#include <QString>
#include <QVector>

/// The Madinah Mushaf drawn as text (ornate frame, surah / juz header, 15 justified lines, verse medallions) - the same look as the portal's text pages.
/// Data: data/mushaf-text.json, font: Amiri Quran (SIL OFL, data/OFL.txt).
namespace MushafText {
/// where every word was painted, so a tap can be mapped to a word (line index, token index in that line)
struct Hit { QRectF r; int li, ti; QString word; };
QImage render(int page, int width, bool night, const QString& theme = "rose", QVector<Hit>* hits = nullptr);
/// which verse a token belongs to: surah, verse, word number (from 1) and the number of words in that verse
struct Loc { int surah, ayah, pos, total; };
Loc locate(int page, int li, int ti);
QString surahName(int surah);
}
