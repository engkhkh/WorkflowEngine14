#include "QuranWords.h"

#include <QHBoxLayout>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMouseEvent>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPushButton>
#include <QRegularExpression>
#include <QVBoxLayout>

#include "I18n.h"

QString QuranWords::apiBase() {
    const QByteArray e = qgetenv("QURAN_API");
    return e.isEmpty() ? QString("https://api.quran.com/api/v4") : QString::fromUtf8(e);
}

QString QuranWords::stripHtml(QString h) {
    h.replace(QRegularExpression("<br\\s*/?>|</p>", QRegularExpression::CaseInsensitiveOption), "\n");
    h.remove(QRegularExpression("<[^>]+>"));
    h.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
    return h.trimmed();
}

void MushafLabel::mousePressEvent(QMouseEvent* e) {
    const QPointF pt = e->position();
    for (const MushafText::Hit& h : hits)
        if (h.r.contains(pt)) { emit wordClicked(page, h.li, h.ti, h.word); return; }
    QLabel::mousePressEvent(e);
}

WordDialog::WordDialog(QWidget* parent, int page, int li, int ti, const QString& word) : QDialog(parent) {
    setWindowTitle(I18n::t("mus.q.word"));
    setMinimumWidth(460);
    loc = MushafText::locate(page, li, ti);
    auto* lay = new QVBoxLayout(this);
    auto* wd = new QLabel(word);
    wd->setAlignment(Qt::AlignCenter);
    wd->setStyleSheet("font-size:34px;");
    lay->addWidget(wd);
    auto* ref = new QLabel(QString("%1 · %2").arg(MushafText::surahName(loc.surah)).arg(loc.ayah));
    ref->setAlignment(Qt::AlignCenter);
    lay->addWidget(ref);
    meaning = new QLabel(QString::fromUtf8("…"));
    meaning->setAlignment(Qt::AlignCenter);
    meaning->setWordWrap(true);
    meaning->setStyleSheet("font-size:16px;font-weight:bold;");
    lay->addWidget(meaning);
    verse = new QLabel;
    verse->setWordWrap(true);
    lay->addWidget(verse);
    auto* row = new QHBoxLayout;
    auto* bar = new QPushButton(QString::fromUtf8("التفسير الميسر"));
    auto* ben = new QPushButton("Tafsir Ibn Kathir");
    connect(bar, &QPushButton::clicked, this, [this] { showTafsir("ar"); });
    connect(ben, &QPushButton::clicked, this, [this] { showTafsir("en"); });
    row->addWidget(bar);
    row->addWidget(ben);
    lay->addLayout(row);
    tf = new QPlainTextEdit;
    tf->setReadOnly(true);
    tf->setMinimumHeight(150);
    tf->hide();
    lay->addWidget(tf);
    auto* close = new QPushButton(I18n::t("common.close"));
    connect(close, &QPushButton::clicked, this, &QDialog::accept);
    lay->addWidget(close);

    const QString url = QString("%1/verses/by_key/%2:%3?words=true&word_fields=transliteration&translations=20&language=en").arg(QuranWords::apiBase()).arg(loc.surah).arg(loc.ayah);
    getJson(url, [this](const QJsonObject& o) {
        if (o.contains("_error")) { meaning->setText(I18n::t("mus.q.offline") + "\n" + o.value("_error").toString()); return; }
        const QJsonObject v = o.value("verse").toObject();
        QJsonArray words;
        for (const QJsonValue& w : v.value("words").toArray())
            if (w.toObject().value("char_type_name").toString("word") == "word") words.append(w);
        QString mean, tr;
        if (words.size() == loc.total && loc.pos > 0 && loc.pos <= words.size()) {
            const QJsonObject w = words.at(loc.pos - 1).toObject();
            mean = w.value("translation").toObject().value("text").toString();
            tr = w.value("transliteration").toObject().value("text").toString();
        }
        meaning->setText(mean.isEmpty() ? I18n::t("mus.q.nomeaning") : mean + (tr.isEmpty() ? QString() : "  ·  " + tr));
        verse->setText(QuranWords::stripHtml(v.value("translations").toArray().at(0).toObject().value("text").toString()));
    });
}

void WordDialog::showTafsir(const QString& lang) {
    tf->show();
    tf->setLayoutDirection(lang == "ar" ? Qt::RightToLeft : Qt::LeftToRight);
    tf->setPlainText(QString::fromUtf8("…"));
    const int id = lang == "ar" ? 16 : 169;
    getJson(QString("%1/tafsirs/%2/by_ayah/%3:%4").arg(QuranWords::apiBase()).arg(id).arg(loc.surah).arg(loc.ayah), [this](const QJsonObject& o) {
        if (o.contains("_error")) { tf->setPlainText(I18n::t("mus.q.offline") + "\n" + o.value("_error").toString()); return; }
        const QString s = QuranWords::stripHtml(o.value("tafsir").toObject().value("text").toString());
        tf->setPlainText(s.isEmpty() ? "-" : s);
    });
}

void WordDialog::getJson(const QString& url, std::function<void(const QJsonObject&)> ok) {
    QNetworkRequest rq{QUrl(url)};
    rq.setRawHeader("Accept", "application/json");
    rq.setRawHeader("User-Agent", "WorkflowErp-Desktop");
    rq.setTransferTimeout(20000);
    QNetworkReply* r = nam.get(rq);
    connect(r, &QNetworkReply::finished, this, [r, ok] {
        QJsonObject o;
        if (r->error() != QNetworkReply::NoError) o.insert("_error", r->errorString());
        else o = QJsonDocument::fromJson(r->readAll()).object();
        r->deleteLater();
        ok(o);
    });
}
