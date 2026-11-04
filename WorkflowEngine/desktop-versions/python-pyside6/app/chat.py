from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QLineEdit, QScrollArea, QVBoxLayout, QWidget

from . import i18n
from .api import api
from .i18n import t
from .pages import Page
from .ui import button, run_async


class ChatPage(Page):
    """The ERP assistant. Questions go to POST api/assistant/chat, which answers from the live data this user may see."""

    def __init__(self, open_action):
        super().__init__()
        self.open_action = open_action
        self.history = []
        self.busy = False
        self.title(t('chat.title'))

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.NoFrame)
        self.log = QWidget()
        self.log_lay = QVBoxLayout(self.log)
        self.log_lay.setAlignment(Qt.AlignTop)
        self.log_lay.setSpacing(8)
        self.scroll.setWidget(self.log)
        self.lay.addWidget(self.scroll, 1)

        self.sugs = QHBoxLayout()
        self.sugs.setAlignment(Qt.AlignLeft)
        self.lay.addLayout(self.sugs)

        row = QHBoxLayout()
        self.input = QLineEdit()
        self.input.setPlaceholderText(t('chat.placeholder'))
        self.input.returnPressed.connect(self.send)
        self.send_btn = button(t('chat.send'), self.send)
        row.addWidget(self.input, 1)
        row.addWidget(self.send_btn)
        self.lay.addLayout(row)
        self.add_bubble(False, t('chat.greet'), [])

    def add_bubble(self, mine, text, actions):
        box = QFrame()
        box.setObjectName('card')
        lay = QVBoxLayout(box)
        msg = QLabel(text)
        msg.setWordWrap(True)
        msg.setTextInteractionFlags(Qt.TextSelectableByMouse)
        lay.addWidget(msg)
        if actions:
            row = QHBoxLayout()
            row.setAlignment(Qt.AlignLeft)
            for a in actions:
                row.addWidget(button(a['label'] + ' ›', lambda _=False, a=a: self.open_action(a['module'], a['kind']), 'ghost'))
            lay.addLayout(row)
        if mine:
            box.setStyleSheet('QFrame#card { background: #dbeafe; }')
        outer = QHBoxLayout()
        if mine:
            outer.addStretch(1)
            outer.addWidget(box, 3)
        else:
            outer.addWidget(box, 3)
            outer.addStretch(1)
        wrap = QWidget()
        wrap.setLayout(outer)
        outer.setContentsMargins(0, 0, 0, 0)
        self.log_lay.addWidget(wrap)
        bar = self.scroll.verticalScrollBar()
        bar.setValue(bar.maximum())
        return wrap

    def send(self, text=None):
        q = (text if isinstance(text, str) else self.input.text()).strip()
        if not q or self.busy:
            return
        self.busy = True
        self.send_btn.setEnabled(False)
        self.input.clear()
        history = self.history[-6:]
        self.history.append({'from': 'user', 'text': q})
        self.add_bubble(True, q, [])
        thinking = self.add_bubble(False, t('chat.thinking'), [])

        def done():
            thinking.setParent(None)
            thinking.deleteLater()
            self.busy = False
            self.send_btn.setEnabled(True)
            bar = self.scroll.verticalScrollBar()
            bar.setValue(bar.maximum())

        def ok(r):
            done()
            reply = r.get('reply', '')
            self.history.append({'from': 'ai', 'text': reply})
            self.add_bubble(False, reply, r.get('actions') or [])
            while self.sugs.count():
                it = self.sugs.takeAt(0)
                if it.widget():
                    it.widget().deleteLater()
            for s in r.get('suggestions') or []:
                self.sugs.addWidget(button(s, lambda _=False, s=s: self.send(s), 'ghost'))

        def bad(_m):
            done()
            self.add_bubble(False, t('chat.error'), [])

        run_async(lambda: api.chat(q, i18n.lang, history), ok, bad)
