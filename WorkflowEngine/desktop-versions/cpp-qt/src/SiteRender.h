#pragma once
#include <QJsonObject>
#include <QString>

/// Turns a site design (theme + pages of blocks) into one self-contained html document - a port of the portal's site-renderer.ts.
/// The css, the cart script and the labels come from website.json (shared by every desktop app); only the blocks are rendered here.
namespace SiteRender {
const QJsonObject& spec();
QString render(const QJsonObject& design, const QString& orderUrl = {}, const QString& messageUrl = {}, const QString& mode = "download");
QString js(const QJsonValue& v);   // String(v ?? '') the way JavaScript prints it
}
