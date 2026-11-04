#pragma once
#include <QDialog>
#include <QLabel>
#include <QNetworkAccessManager>
#include <QPlainTextEdit>
#include <QVector>

#include "MushafText.h"

/// Tap a word of the Quran text pages: meaning, verse translation and tafsir from the public Quran.com API (needs internet;
/// the address can be changed with the environment variable QURAN_API).
namespace QuranWords {
QString apiBase();
QString stripHtml(QString h);
}

/// a page image that reports which word was clicked
class MushafLabel : public QLabel {
    Q_OBJECT
public:
    QVector<MushafText::Hit> hits;
    int page = 0;
protected:
    void mousePressEvent(QMouseEvent* e) override;
signals:
    void wordClicked(int page, int li, int ti, const QString& word);
};

class WordDialog : public QDialog {
    Q_OBJECT
public:
    WordDialog(QWidget* parent, int page, int li, int ti, const QString& word);
    QString meaningText() const { return meaning->text(); }
    QString verseText() const { return verse->text(); }
    QString tafsirText() const { return tf->toPlainText(); }
    void showTafsir(const QString& lang);   // "ar" or "en"
    MushafText::Loc loc;
private:
    void getJson(const QString& url, std::function<void(const QJsonObject&)> ok);
    QLabel *meaning, *verse;
    QPlainTextEdit* tf;
    QNetworkAccessManager nam;
};
