#pragma once
#include <QDialog>
#include <QGraphicsItem>
#include <QGraphicsPathItem>
#include <QGraphicsScene>
#include <QGraphicsSimpleTextItem>
#include <QGraphicsView>
#include <QHash>
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QScrollArea>
#include <QTabWidget>
#include <QTableWidget>
#include <QTimer>
#include <functional>

#include "Pages.h"

/// Workflow designer, flows list and instance monitor - driven by workflow.json (the spec shared by every desktop client).
namespace Wf {
QJsonObject spec();
QJsonObject typeSpec(const QString& type);
QString shapeOf(const QString& type);
QSize sizeOf(const QString& type);
QString newId();
QJsonObject newNode(const QString& type, int x, int y);

/// The definition being edited: header fields + nodes + edges (QJsonObject is a value type, so edits go through here).
struct Model {
    QJsonObject meta;                 // id, name, description, isPublished, version, ...
    QList<QJsonObject> nodes, edges;
    void fromJson(const QJsonObject& d);
    QJsonObject body() const;         // what POST/PUT /definitions expects
    int nodeIdx(const QString& id) const;
    int edgeIdx(const QString& id) const;
};

class Canvas;

class NodeItem : public QGraphicsItem {
public:
    NodeItem(Canvas* c, const QString& id);
    QRectF boundingRect() const override;
    void paint(QPainter* p, const QStyleOptionGraphicsItem*, QWidget*) override;
    QString id;
    QString state;   // "", active, visited, rejected, pending
protected:
    QVariant itemChange(GraphicsItemChange change, const QVariant& value) override;
    void mousePressEvent(QGraphicsSceneMouseEvent* e) override;
private:
    Canvas* c_;
};

class EdgeItem : public QGraphicsPathItem {
public:
    EdgeItem(Canvas* c, const QString& id);
    void update_();
    QPainterPath shape() const override;
    void paint(QPainter* p, const QStyleOptionGraphicsItem*, QWidget*) override;
    QString id, state;   // state: "", ok, rejected
private:
    Canvas* c_;
    QGraphicsSimpleTextItem* txt_;
};

class Canvas : public QGraphicsView {
    Q_OBJECT
public:
    Canvas(Model* m, bool editable, QWidget* parent = nullptr);
    ~Canvas() override { rebuilding_ = true; onSelect = nullptr; onChange = nullptr; }
    Model* m;
    bool editable;
    bool linkMode = false;
    QString linkFrom;
    QHash<QString, QString> states, edgeStates;
    std::function<void(const QString& nodeId, const QString& edgeId)> onSelect;
    std::function<void()> onChange;
    void rebuild();
    void refreshEdges();
    void setLinkMode(bool on);
    void handleLink(const QString& id);
    void addNode(const QString& type);
    void deleteSelected();
    QString selectedNode() const;
    QString selectedEdge() const;
    void selectNode(const QString& id);
    QPointF center(const QJsonObject& node) const;
    void changed() { if (onChange) onChange(); }
    QHash<QString, NodeItem*> items;
    QList<EdgeItem*> edgeItems;
protected:
    void wheelEvent(QWheelEvent* e) override;
private:
    QGraphicsScene* sc_;
    bool rebuilding_ = false;
};

class FormDialog : public QDialog {
    Q_OBJECT
public:
    FormDialog(QWidget* parent, const QJsonObject& form);
    QJsonObject result() const;
private:
    void addRow(const QJsonObject& f);
    QLineEdit* title_;
    QTableWidget* tbl_;
};

class DesignerDialog : public QDialog {
    Q_OBJECT
public:
    DesignerDialog(QWidget* parent, const QString& defId);
    Model model;
    Canvas* canvas;
    QString saveStatusForTest() const { return status_->text(); }
    void save(std::function<void()> then = nullptr);
    void publish();
    void run();
    void buildNode(const QString& id);
    QLineEdit* nameEdit() { return name_; }
private:
    void apply();
    void onSelect(const QString& nid, const QString& eid);
    void buildEdge(const QString& id);
    void showEmpty();
    QWidget* editor(const QString& nid, const QJsonObject& p, bool rebuild);
    void setVal(const QString& nid, const QString& key, const QJsonValue& v, bool rebuild);
    void setPanel(QWidget* w);
    QLineEdit *name_, *desc_;
    QLabel *badge_, *status_;
    QPushButton *save_, *pub_, *run_, *del_, *link_;
    QScrollArea* panelScroll_;
    QJsonArray users_, published_;
    QStringList roles_;
    bool canDesign_;
};

class InstanceDialog : public QDialog {
    Q_OBJECT
public:
    InstanceDialog(QWidget* parent, const QString& id);
    Canvas* canvasForTest() { return canvas_; }
    int timelineCount() const { return timeline_->count(); }
private:
    void refresh();
    void paint();
    QString id_;
    QJsonObject inst_;
    Model model_;
    bool haveDef_ = false;
    Canvas* canvas_ = nullptr;
    QVBoxLayout* holder_;
    QLabel *head_, *meta_;
    QPushButton* cancel_;
    QListWidget *timeline_, *log_;
    QTableWidget* data_;
    QTimer timer_;
};
}

class WorkflowPage : public Page {
    Q_OBJECT
public:
    WorkflowPage();
    void reload() override;
    QTableWidget* defsForTest() { return defs_; }
private:
    void open();
    void start();
    void remove();
    QTabWidget* tabs_;
    QTableWidget* defs_;
    QHash<QString, QTableWidget*> inst_;
    QStringList instOrder_;
};
