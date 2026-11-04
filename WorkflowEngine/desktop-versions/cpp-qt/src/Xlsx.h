#pragma once
#include <QByteArray>
#include <QString>
#include <QVariant>
#include <QVector>

/// Reading an .xlsx file without any extra library: a zip of XML files (own inflate), plus a CSV reader.
namespace Xlsx {
using Table = QVector<QVector<QVariant>>;   // cell: QString, double, or an invalid QVariant for an empty cell
bool inflate(const QByteArray& in, int outSize, QByteArray& out);   // raw deflate stream
bool unzip(const QByteArray& zip, const QString& name, QByteArray& out);
QStringList zipNames(const QByteArray& zip);
bool readXlsx(const QString& path, Table& rows);
Table parseCsv(const QString& text);
bool readTable(const QString& path, Table& rows, QString& err);   // err: "type" or "read"
}
