from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal, Qt
from PySide6.QtWidgets import QHeaderView, QMessageBox, QTableWidget, QTableWidgetItem, QAbstractItemView

PRIMARY = '#2563eb'
DIM = '#64748b'
DANGER = '#dc2626'

STYLE = f"""
QMainWindow, QDialog {{ background: #f4f6fa; }}
QListWidget#nav {{ background: #0f172a; color: #cbd5e1; border: none; font-size: 14px; outline: 0; }}
QListWidget#nav::item {{ padding: 12px 16px; }}
QListWidget#nav::item:selected {{ background: {PRIMARY}; color: white; }}
QPushButton {{ background: {PRIMARY}; color: white; border: none; border-radius: 6px; padding: 7px 14px; }}
QPushButton:disabled {{ background: #94a3b8; }}
QPushButton[kind="ghost"] {{ background: white; color: {PRIMARY}; border: 1px solid {PRIMARY}; }}
QPushButton[kind="danger"] {{ background: {DANGER}; }}
QLineEdit, QTextEdit, QComboBox {{ background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; }}
QTableWidget {{ background: white; border: 1px solid #e2e8f0; gridline-color: #eef2f7; }}
QHeaderView::section {{ background: #f1f5f9; border: none; padding: 6px; font-weight: 600; }}
QLabel[role="title"] {{ font-size: 20px; font-weight: 700; }}
QLabel[role="dim"] {{ color: {DIM}; }}
QLabel[role="error"] {{ color: {DANGER}; }}
QFrame[card="true"] {{ background: white; border: 1px solid #e2e8f0; border-radius: 10px; }}
"""


class _Signals(QObject):
    done = Signal(object)
    failed = Signal(str)


class _Job(QRunnable):
    def __init__(self, fn, sig):
        super().__init__()
        self.fn, self.sig = fn, sig

    def run(self):
        try:
            r = self.fn()
        except Exception as e:  # noqa: BLE001 - every failure is shown to the user
            self.sig.failed.emit(str(e))
        else:
            self.sig.done.emit(r)


_alive = set()


def run_async(fn, ok=None, err=None):
    """Runs fn on a worker thread; ok(result) / err(message) are called on the UI thread."""
    sig = _Signals()
    _alive.add(sig)

    def finish():
        _alive.discard(sig)

    sig.done.connect(lambda r: (ok(r) if ok else None, finish()))
    sig.failed.connect(lambda m: (err(m) if err else None, finish()))
    QThreadPool.globalInstance().start(_Job(fn, sig))


def button(text, slot, kind=None):
    from PySide6.QtWidgets import QPushButton
    b = QPushButton(text)
    if kind:
        b.setProperty('kind', kind)
    b.clicked.connect(lambda *_: slot())
    return b


def label(text, role=None):
    from PySide6.QtWidgets import QLabel
    l = QLabel(text)
    if role:
        l.setProperty('role', role)
    l.setWordWrap(True)
    return l


def make_table(headers):
    t = QTableWidget(0, len(headers))
    t.setHorizontalHeaderLabels(headers)
    t.setEditTriggers(QAbstractItemView.NoEditTriggers)
    t.setSelectionBehavior(QAbstractItemView.SelectRows)
    t.setSelectionMode(QAbstractItemView.SingleSelection)
    t.verticalHeader().setVisible(False)
    t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
    t.setAlternatingRowColors(True)
    return t


def fill_table(table, rows, payloads):
    """rows = list of lists of strings; payloads[i] is stored on row i."""
    table.setRowCount(len(rows))
    for i, row in enumerate(rows):
        for j, text in enumerate(row):
            it = QTableWidgetItem(text)
            if j == 0:
                it.setData(Qt.UserRole, i)
            table.setItem(i, j, it)
    table._payloads = payloads


def current_payload(table):
    r = table.currentRow()
    p = getattr(table, '_payloads', [])
    return p[r] if 0 <= r < len(p) else None


def warn(parent, text):
    QMessageBox.warning(parent, '', text)


def ask(parent, text, yes, no):
    box = QMessageBox(QMessageBox.Question, '', text, parent=parent)
    y = box.addButton(yes, QMessageBox.YesRole)
    box.addButton(no, QMessageBox.NoRole)
    box.exec()
    return box.clickedButton() is y
