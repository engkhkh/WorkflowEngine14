#include "ReportDialog.h"

#include <QFileDialog>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLocale>
#include <QMarginsF>
#include <QPageLayout>
#include <QPageSize>
#include <QPrintDialog>
#include <QPrinter>
#include <QPushButton>
#include <QSignalBlocker>
#include <QTextDocument>
#include <QVBoxLayout>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

namespace {
QString esc(const QString& s) { return s.toHtmlEscaped(); }
QString pre(const QString& s) { return esc(s).replace('\n', "<br>"); }
QString nf(double n) { QString s = QLocale(QLocale::English).toString(n, 'f', 2); if (s.contains('.')) { while (s.endsWith('0')) s.chop(1); if (s.endsWith('.')) s.chop(1); } return s; }
double rawNum(const ReportRow& r, const QString& k) {
    bool ok = false; double v = r.value(k + "#", r.value(k)).remove(',').toDouble(&ok);
    return ok ? v : 0;
}
}

QString buildReportHtml(const ReportLayout& L, const QList<ReportColumn>& columns, const QList<ReportRow>& rows, const QString& user) {
    QList<ReportColumn> cols;
    for (const QString& k : L.order) if (L.columns.contains(k)) for (const auto& c : columns) if (c.key == k) cols << c;
    const int ncol = cols.size() + (L.rowNumbers ? 1 : 0);
    QString head = "<tr>";
    if (L.rowNumbers) head += "<th bgcolor=#f1f3f5>#</th>";
    for (const auto& c : cols) head += QString("<th align=\"%1\" bgcolor=\"#f1f3f5\">%2</th>").arg(c.numeric ? "right" : "left", esc(c.label));
    head += "</tr>";
    int idx = 0;
    auto row = [&](const ReportRow& r) {
        QString s = "<tr>";
        if (L.rowNumbers) s += QString("<td align=\"right\">%1</td>").arg(++idx);
        for (const auto& c : cols) s += QString("<td align=\"%1\">%2</td>").arg(c.numeric ? "right" : "left", esc(r.value(c.key)));
        return s + "</tr>";
    };
    auto total = [&](const QList<ReportRow>& rs, const QString& label) -> QString {
        bool any = false; for (const auto& c : cols) any |= c.numeric;
        if (!L.totals || !any) return {};
        QString s = "<tr bgcolor=\"#fafafa\">";
        if (L.rowNumbers) s += "<td></td>";
        for (int i = 0; i < cols.size(); ++i) {
            if (cols[i].numeric) { double sum = 0; for (const auto& r : rs) sum += rawNum(r, cols[i].key); s += QString("<td align=\"right\"><b>%1</b></td>").arg(nf(sum)); }
            else s += QString("<td><b>%1</b></td>").arg(i == 0 ? esc(label) : QString());
        }
        return s + "</tr>";
    };
    QString body;
    if (!L.groupBy.isEmpty() && !cols.isEmpty()) {
        QStringList order; QMap<QString, QList<ReportRow>> groups;
        for (const auto& r : rows) { QString g = r.value(L.groupBy); if (g.isEmpty()) g = QString::fromUtf8("—"); if (!groups.contains(g)) order << g; groups[g] << r; }
        QString glabel; for (const auto& c : columns) if (c.key == L.groupBy) glabel = c.label;
        for (const QString& g : order) {
            body += QString("<tr bgcolor=\"#e8ecf1\"><td colspan=\"%1\"><b>%2: %3 (%4)</b></td></tr>").arg(ncol).arg(esc(glabel), esc(g)).arg(groups[g].size());
            for (const auto& r : groups[g]) body += row(r);
            body += total(groups[g], t("collab.rep.subtotal"));
        }
        body += total(rows, t("collab.rep.total"));
    } else {
        for (const auto& r : rows) body += row(r);
        body += total(rows, t("collab.rep.total"));
    }
    QStringList meta;
    if (L.showDate) meta << QDateTime::currentDateTime().toString("yyyy-MM-dd HH:mm");
    if (L.showUser && !user.isEmpty()) meta << user;
    meta << QString("%1 %2").arg(rows.size()).arg(t("collab.rep.rows"));
    return QString("<html dir=\"%1\"><body style=\"font-family:Segoe UI,Tahoma,Arial; font-size:10pt; color:#111;\"><h2 style=\"margin:0\">%2</h2>").arg(I18n::rtl() ? "rtl" : "ltr", esc(L.title))
        + (L.subtitle.isEmpty() ? QString() : QString("<p style=\"color:#555; margin:2px 0\">%1</p>").arg(esc(L.subtitle)))
        + (L.header.isEmpty() ? QString() : QString("<p>%1</p>").arg(pre(L.header)))
        + QString("<p style=\"color:#666; font-size:8pt\">%1</p><hr><table width=\"100%\" cellspacing=\"0\" cellpadding=\"4\">%2%3</table>").arg(esc(meta.join(" · ")), head, body)
        + (L.footer.isEmpty() ? QString() : QString("<hr><p style=\"color:#444\">%1</p>").arg(pre(L.footer))) + "</body></html>";
}

static void setupPrinter(QPrinter& pr, const ReportLayout& L) {
    pr.setPageSize(QPageSize(QPageSize::A4));
    pr.setPageOrientation(L.orientation == "landscape" ? QPageLayout::Landscape : QPageLayout::Portrait);
    pr.setPageMargins(QMarginsF(12, 12, 12, 12), QPageLayout::Millimeter);
}

bool saveReportPdf(const QString& html, const ReportLayout& L, const QString& path) {
    QPrinter pr(QPrinter::HighResolution);
    setupPrinter(pr, L);
    pr.setOutputFormat(QPrinter::PdfFormat);
    pr.setOutputFileName(path);
    QTextDocument doc;
    doc.setHtml(html);
    doc.print(&pr);
    return true;
}

ReportDialog::ReportDialog(QWidget* parent, const QString& view, const QString& title, const QList<ReportColumn>& cols, const QList<ReportRow>& rows, const QString& user)
    : QDialog(parent), view_(view), user_(user), cols_(cols), rows_(rows) {
    setWindowTitle(t("collab.reportDesigner"));
    resize(1100, 680);
    auto* lay = new QHBoxLayout(this);
    auto* side = new QWidget; side->setFixedWidth(310);
    auto* sl = new QVBoxLayout(side); sl->setContentsMargins(0, 0, 8, 0);
    auto* top = new QHBoxLayout;
    sel = new QComboBox; top->addWidget(sel, 1);
    bDel = Ui::button(QString::fromUtf8("🗑"), [this] { deleteLayout(); }, "ghost"); bDel->setEnabled(false); top->addWidget(bDel);
    sl->addLayout(top);
    auto* f = new QFormLayout;
    eTitle = new QLineEdit(title); eSub = new QLineEdit; eHead = new QPlainTextEdit; eFoot = new QPlainTextEdit;
    eHead->setFixedHeight(46); eFoot->setFixedHeight(46);
    orient = new QComboBox; orient->addItem(t("collab.rep.portrait"), "portrait"); orient->addItem(t("collab.rep.landscape"), "landscape");
    if (cols.size() > 6) orient->setCurrentIndex(1);
    group = new QComboBox; group->addItem(QString::fromUtf8("—"), QString());
    for (const auto& c : cols) group->addItem(c.label, c.key);
    f->addRow(t("collab.rep.title"), eTitle); f->addRow(t("collab.rep.subtitle"), eSub); f->addRow(t("collab.rep.header"), eHead); f->addRow(t("collab.rep.footer"), eFoot);
    f->addRow(t("collab.rep.orientation"), orient); f->addRow(t("collab.rep.groupBy"), group);
    sl->addLayout(f);
    kTot = new QCheckBox(t("collab.rep.totals")); kNum = new QCheckBox(t("collab.rep.rowNumbers")); kDate = new QCheckBox(t("collab.rep.showDate")); kUser = new QCheckBox(t("collab.rep.showUser"));
    kTot->setChecked(true); kDate->setChecked(true); kUser->setChecked(true);
    for (QCheckBox* k : {kTot, kNum, kDate, kUser}) { sl->addWidget(k); connect(k, &QCheckBox::toggled, this, [this] { refresh(); }); }
    sl->addWidget(new QLabel(t("collab.rep.columns")));
    lst = new QListWidget;
    for (const auto& c : cols) { auto* it = new QListWidgetItem(c.label); it->setData(Qt::UserRole, c.key); it->setFlags(it->flags() | Qt::ItemIsUserCheckable); it->setCheckState(Qt::Checked); lst->addItem(it); }
    lst->setDragDropMode(QAbstractItemView::InternalMove);
    connect(lst, &QListWidget::itemChanged, this, [this] { refresh(); });
    connect(lst->model(), &QAbstractItemModel::rowsMoved, this, [this] { refresh(); });
    sl->addWidget(lst, 1);
    auto* mv = new QHBoxLayout; mv->addWidget(Ui::button(QString::fromUtf8("▲"), [this] { move(-1); }, "ghost")); mv->addWidget(Ui::button(QString::fromUtf8("▼"), [this] { move(1); }, "ghost")); sl->addLayout(mv);
    eName = new QLineEdit; eName->setPlaceholderText(t("collab.rep.layoutName"));
    kShare = new QCheckBox(t("collab.shareWorkspace"));
    sl->addWidget(eName); sl->addWidget(kShare); sl->addWidget(Ui::button(t("collab.rep.saveLayout"), [this] { saveLayout(); }));
    err = new QLabel; err->setStyleSheet("color:#dc2626"); err->setWordWrap(true); sl->addWidget(err);
    lay->addWidget(side);
    auto* right = new QVBoxLayout;
    prev = new QTextBrowser; prev->setStyleSheet("background:#fff; color:#111;");
    right->addWidget(prev, 1);
    auto* bar = new QHBoxLayout; bar->addStretch();
    bar->addWidget(Ui::button(t("common.cancel"), [this] { reject(); }, "ghost")); bar->addWidget(Ui::button("PDF", [this] { pdfIt(); }, "ghost"));
    bar->addWidget(Ui::button(QString::fromUtf8("🖨 ") + t("collab.rep.print"), [this] { printIt(); }));
    right->addLayout(bar);
    lay->addLayout(right, 1);
    for (QLineEdit* e : {eTitle, eSub}) connect(e, &QLineEdit::textChanged, this, [this] { refresh(); });
    for (QPlainTextEdit* e : {eHead, eFoot}) connect(e, &QPlainTextEdit::textChanged, this, [this] { refresh(); });
    connect(orient, &QComboBox::currentIndexChanged, this, [this] { refresh(); });
    connect(group, &QComboBox::currentIndexChanged, this, [this] { refresh(); });
    connect(sel, &QComboBox::activated, this, [this](int i) {
        const QJsonObject c = sel->itemData(i).toJsonObject();
        bDel->setEnabled(c.value("mine").toBool());
        if (!c.isEmpty()) applyLayout(c.value("data").toObject());
    });
    refresh();
    loadSaved();
}

ReportLayout ReportDialog::layout() const {
    ReportLayout L;
    for (int i = 0; i < lst->count(); ++i) { L.order << lst->item(i)->data(Qt::UserRole).toString(); if (lst->item(i)->checkState() == Qt::Checked) L.columns << L.order.last(); }
    L.title = eTitle->text(); L.subtitle = eSub->text(); L.header = eHead->toPlainText(); L.footer = eFoot->toPlainText();
    L.orientation = orient->currentData().toString(); L.groupBy = group->currentData().toString();
    L.totals = kTot->isChecked(); L.showDate = kDate->isChecked(); L.showUser = kUser->isChecked(); L.rowNumbers = kNum->isChecked();
    return L;
}

void ReportDialog::applyLayout(const QJsonObject& d) {
    QStringList cols;
    for (const QJsonValue& v : d.value("columns").toArray()) for (const auto& c : cols_) if (c.key == v.toString()) cols << c.key;
    if (cols.isEmpty()) for (const auto& c : cols_) cols << c.key;
    QStringList order = cols;
    for (const auto& c : cols_) if (!order.contains(c.key)) order << c.key;
    {
        QSignalBlocker b(lst);
        lst->clear();
        for (const QString& k : order) {
            QString lab; for (const auto& c : cols_) if (c.key == k) lab = c.label;
            auto* it = new QListWidgetItem(lab); it->setData(Qt::UserRole, k); it->setFlags(it->flags() | Qt::ItemIsUserCheckable); it->setCheckState(cols.contains(k) ? Qt::Checked : Qt::Unchecked); lst->addItem(it);
        }
    }
    eTitle->setText(d.value("title").toString()); eSub->setText(d.value("subtitle").toString()); eHead->setPlainText(d.value("header").toString()); eFoot->setPlainText(d.value("footer").toString());
    orient->setCurrentIndex(d.value("orientation").toString() == "landscape" ? 1 : 0);
    group->setCurrentIndex(qMax(0, group->findData(d.value("groupBy").toString())));
    kTot->setChecked(d.value("totals").toBool(true)); kDate->setChecked(d.value("showDate").toBool(true)); kUser->setChecked(d.value("showUser").toBool(true)); kNum->setChecked(d.value("rowNumbers").toBool(false));
    refresh();
}

void ReportDialog::refresh() { prev->setHtml(html()); }

void ReportDialog::move(int d) {
    const int r = lst->currentRow(), j = r + d;
    if (r < 0 || j < 0 || j >= lst->count()) return;
    auto* it = lst->takeItem(r); lst->insertItem(j, it); lst->setCurrentRow(j); refresh();
}

void ReportDialog::loadSaved() {
    Api::I().configs("report", view_, this, [this](const QJsonValue& v) {
        saved_ = v.toArray();
        sel->clear(); sel->addItem(t("collab.savedReports"), QJsonObject());
        for (const QJsonValue& cv : saved_) {
            const QJsonObject c = cv.toObject();
            sel->addItem((c.value("shared").toBool() && !c.value("mine").toBool() ? QString::fromUtf8("👥 ") : QString()) + c.value("name").toString(), c);
        }
    }, [](const QString&) {});
}

void ReportDialog::saveLayout() {
    const QString n = eName->text().trimmed();
    if (n.isEmpty()) return;
    const ReportLayout L = layout();
    QJsonArray cols; for (const QString& k : L.order) if (L.columns.contains(k)) cols.append(k);
    const QJsonObject data{{"title", L.title}, {"subtitle", L.subtitle}, {"header", L.header}, {"footer", L.footer}, {"orientation", L.orientation}, {"columns", cols},
                           {"groupBy", L.groupBy}, {"totals", L.totals}, {"showDate", L.showDate}, {"showUser", L.showUser}, {"rowNumbers", L.rowNumbers}};
    err->clear();
    Api::I().saveConfig("report", view_, n, kShare->isChecked(), data, this, [this](const QJsonValue&) { eName->clear(); loadSaved(); }, [this](const QString& e) { err->setText(e); });
}

void ReportDialog::deleteLayout() {
    const QJsonObject c = sel->currentData().toJsonObject();
    if (!c.value("mine").toBool()) return;
    Api::I().deleteConfig("report", c.value("id").toString(), this, [this](const QJsonValue&) { loadSaved(); }, [this](const QString& e) { err->setText(e); });
}

void ReportDialog::pdfIt() {
    const QString path = QFileDialog::getSaveFileName(this, "PDF", (layout().title.isEmpty() ? QString("report") : layout().title) + ".pdf", "PDF (*.pdf)");
    if (!path.isEmpty()) saveReportPdf(html(), layout(), path);
}

void ReportDialog::printIt() {
    QPrinter pr(QPrinter::HighResolution);
    setupPrinter(pr, layout());
    QPrintDialog dlg(&pr, this);
    if (dlg.exec() != QDialog::Accepted) return;
    QTextDocument doc; doc.setHtml(html()); doc.print(&pr);
}
