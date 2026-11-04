#pragma once
#include <QListWidget>
#include <QMainWindow>
#include <QStackedWidget>
#include <functional>

#include "Pages.h"

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(std::function<void()> relaunch);
    void goPage(int i);
    QList<Page*> pages;
    ErpPage* erp;
private:
    QListWidget* nav;
    QStackedWidget* stack;
    std::function<void()> relaunch_;
};
