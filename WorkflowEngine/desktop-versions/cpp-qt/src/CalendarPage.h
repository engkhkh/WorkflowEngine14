#pragma once
#include <QComboBox>
#include <QDate>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QMap>
#include <QTabWidget>

#include "Pages.h"

/// Calendar and meetings: agenda (day / week / month), events, meetings with a join link, RSVP, availability check, to-dos and settings.
/// The server keeps UTC; the screen shows the computer's own time zone.
namespace Cal {
extern const char* kFmt;   // "yyyy-MM-dd HH:mm"
QDateTime toLocal(const QString& iso);
QString toUtcIso(const QDateTime& dt);
QString parseLocal(const QString& s, bool* ok);   // "" when empty; ok=false when malformed
QString fmtLocal(const QString& iso);
void period(const QString& view, const QDate& anchor, QDateTime& from, QDateTime& to);
QDate shift(const QString& view, const QDate& anchor, int n);
/// form values (kind, title, start, end, location, notes, repeat, until, remind, priority, attendees[array], guests) -> request body; err gets the message on bad input
QJsonObject eventPayload(const QJsonObject& v, QString& err);
}

class CalAgenda : public QWidget {
    Q_OBJECT
public:
    CalAgenda();
    void reload();
    QString view = "week";
    QDate anchor = QDate::currentDate();
    QJsonArray items, people;
    QComboBox* vsel;
    QLabel *rng, *err;
    QTableWidget* table;
    QMap<QString, QPushButton*> btn;
    void edit(const QJsonObject& item, bool isNew);
    void paint();
    void sel();
};

class CalTodos : public QWidget {
    Q_OBJECT
public:
    CalTodos();
    void reload();
    QJsonArray items;
    QLineEdit *title, *due;
    QComboBox* prio;
    QTableWidget* table;
    QLabel* err;
    void add();
    void paint(const QJsonArray& a);
};

class CalSettings : public QWidget {
    Q_OBJECT
public:
    CalSettings();
    void reload();
    QLineEdit *jitsi, *ws, *we;
    QLabel* msg;
    void save();
};

class CalendarPage : public Page {
    Q_OBJECT
public:
    CalendarPage();
    void reload() override;
    QTabWidget* tabs;
    CalAgenda* agenda;
    CalTodos* todos;
    CalSettings* settings = nullptr;
    QList<QWidget*> views;
};
