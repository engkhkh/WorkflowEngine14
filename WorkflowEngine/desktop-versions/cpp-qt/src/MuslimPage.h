#pragma once
#include <QComboBox>
#include <QDoubleSpinBox>
#include <QHash>
#include <QCheckBox>
#include <QListWidget>
#include <QNetworkAccessManager>
#include <QPixmap>
#include <QPushButton>
#include <QScrollArea>
#include <QSet>
#include <QSpinBox>
#include <QTableWidget>
#include <QTabWidget>
#include <QTimer>
#include <functional>

#include "Pages.h"
#include "Prayer.h"

/// Muslim workspace: prayer times (reminders, Qibla, Hijri date) and the Holy Quran as Mushaf page images.
/// Same behaviour as the portal's Muslim module; the settings live on this computer.
class PrayerTab : public QWidget {
    Q_OBJECT
public:
    PrayerTab();
    void refresh();
    void fire(int prayer, int before);
private:
    void setMonthly(bool m);
    void fillCities();
    void loadForm();
    void changed(QObject* src);
    void apply();
    void tick();
    void bell(int row, int col);
    Prayer::Day today() const;

    QLabel *warn, *place, *date, *next, *cd, *qibla, *polar;
    class Dial* dial;
    QTableWidget* table;
    QPushButton *dayB, *monB;
    QComboBox *country, *city, *tz, *method, *asr, *hl, *hj, *clock, *sound;
    QDoubleSpinBox *lat, *lng;
    QSpinBox *adj[6], *remMin[6];
    QCheckBox* remOn[6];
    bool monthly = false, loading = true;
    qint64 nextAt = 0;
    QSet<QString> fired;
};

class MushafReader : public QWidget {
    Q_OBJECT
public:
    explicit MushafReader(std::function<void()> onPage);
    int page() const;
    void go(int p);
    void render();
protected:
    bool eventFilter(QObject* o, QEvent* e) override;
private:
    bool isTwo() const;
    int step() const { return isTwo() ? 2 : 1; }
    QList<int> shown() const;
    int widthPx() const;
    void load(int p, bool quiet);
    void layoutPages();
    void toggleMark();
    void zoom(int d);
    QPushButton *nextB, *prevB, *minus, *plus, *fit, *two, *mode, *theme, *night, *star, *full;
    QSpinBox* pageSp;
    QLabel *where, *zoomL;
    QComboBox *juz, *marks;
    QScrollArea* area;
    QWidget* stage;
    QHBoxLayout* box;
    QLineEdit* base;
    QHash<int, QPixmap> pix;
    QSet<int> failed, loading;
    QNetworkAccessManager nam_;
    std::function<void()> onPage_;
    bool busy_ = false;
};

class QuranTab : public QWidget {
    Q_OBJECT
public:
    QuranTab();
protected:
    void showEvent(QShowEvent* e) override;
private:
    void sync();
    QListWidget* list;
    MushafReader* reader;
};

class MuslimPage : public Page {
    Q_OBJECT
public:
    MuslimPage();
    void reload() override;
    QTabWidget* tabs;
    PrayerTab* times;
    QuranTab* quran;
};
