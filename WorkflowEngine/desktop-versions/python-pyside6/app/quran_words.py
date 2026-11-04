"""Tap a word of the Quran text pages: which verse it belongs to, then its meaning, the verse translation and tafsir from the public Quran.com API
(needs internet; the address can be changed with the environment variable QURAN_API)."""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QHBoxLayout, QLabel, QPlainTextEdit, QPushButton, QVBoxLayout

from .i18n import t
from .mushaf_text import MF, pages
from .ui import run_async

_DATA = Path(__file__).resolve().parent.parent / 'data'
_index = None
TAFSIR_ID = {'ar': 16, 'en': 169}   # Al-Muyassar (Arabic), Ibn Kathir abridged (English)


def api_base():
    return os.environ.get('QURAN_API') or 'https://api.quran.com/api/v4'


def index():
    global _index
    if _index is None:
        _index = json.loads((_DATA / 'mushaf-index.json').read_text(encoding='utf-8'))
    return _index


def locate(page, li, ti):
    """(surah, verse, word number from 1, words in that verse) of token ti on line li of a page"""
    idx = index()
    surah, ayah, wi = idx['start'][page - 1]
    lines = pages()[page - 1]
    for i in range(li + 1):
        ln = lines[i]
        if ln[0] == 'H':
            surah, ayah, wi = ln[1], 1, 0
            continue
        if ln[0] != 'L':
            continue
        for j, tok in enumerate(ln[1]):
            if i == li and j == ti:
                return surah, ayah, wi + 1, idx['count'].get(f'{surah}:{ayah}', 0)
            if tok == '*':
                continue
            if isinstance(tok, int):
                ayah, wi = tok + 1, 0
            else:
                wi += 1
    return surah, ayah, wi + 1, 0


def strip_html(h):
    h = re.sub(r'<br\s*/?>|</p>', '\n', h or '', flags=re.I)
    h = re.sub(r'<[^>]+>', '', h)
    for a, b in (('&nbsp;', ' '), ('&amp;', '&'), ('&quot;', '"'), ('&#39;', "'"), ('&lt;', '<'), ('&gt;', '>')):
        h = h.replace(a, b)
    return h.strip()


def _get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'WorkflowErp-Desktop'}), timeout=20) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise RuntimeError('HTTP %s' % e.code)
    except Exception as e:  # noqa: BLE001 - shown to the user
        raise RuntimeError(str(getattr(e, 'reason', e)))


def fetch_word(surah, ayah, pos, total):
    """{'meaning', 'translit', 'verse'}; the word meaning is only used when this text and Quran.com split the verse into the same number of words"""
    v = (_get(f'{api_base()}/verses/by_key/{surah}:{ayah}?words=true&word_fields=transliteration&translations=20&language=en') or {}).get('verse', {})
    words = [w for w in v.get('words', []) if w.get('char_type_name', 'word') == 'word']
    hit = words[pos - 1] if len(words) == total and 0 < pos <= len(words) else None
    return {'meaning': ((hit or {}).get('translation') or {}).get('text', ''), 'translit': ((hit or {}).get('transliteration') or {}).get('text', ''),
            'verse': strip_html(((v.get('translations') or [{}])[0]).get('text', ''))}


def fetch_tafsir(surah, ayah, lang):
    return strip_html(((_get(f'{api_base()}/tafsirs/{TAFSIR_ID[lang]}/by_ayah/{surah}:{ayah}') or {}).get('tafsir') or {}).get('text', '')) or '-'


class WordDialog(QDialog):
    def __init__(self, parent, page, li, ti, word):
        super().__init__(parent)
        self.setWindowTitle(t('mus.q.word'))
        self.setMinimumWidth(460)
        self.surah, self.ayah, self.pos, self.total = locate(page, li, ti)
        lay = QVBoxLayout(self)
        self.wd = QLabel(word)
        self.wd.setAlignment(Qt.AlignCenter)
        self.wd.setStyleSheet('font-size:34px;')
        lay.addWidget(self.wd)
        self.ref = QLabel(f"{MF['surahAr'][self.surah - 1]} · {self.ayah}")
        self.ref.setAlignment(Qt.AlignCenter)
        lay.addWidget(self.ref)
        self.meaning = QLabel('…')
        self.meaning.setAlignment(Qt.AlignCenter)
        self.meaning.setWordWrap(True)
        self.meaning.setStyleSheet('font-size:16px;font-weight:bold;')
        lay.addWidget(self.meaning)
        self.verse = QLabel('')
        self.verse.setWordWrap(True)
        lay.addWidget(self.verse)
        row = QHBoxLayout()
        self.b_ar, self.b_en = QPushButton('التفسير الميسر'), QPushButton('Tafsir Ibn Kathir')
        self.b_ar.clicked.connect(lambda: self.tafsir('ar'))
        self.b_en.clicked.connect(lambda: self.tafsir('en'))
        row.addWidget(self.b_ar)
        row.addWidget(self.b_en)
        lay.addLayout(row)
        self.tf = QPlainTextEdit()
        self.tf.setReadOnly(True)
        self.tf.setMinimumHeight(150)
        self.tf.hide()
        lay.addWidget(self.tf)
        close = QPushButton(t('common.close'))
        close.clicked.connect(self.accept)
        lay.addWidget(close)
        run_async(lambda: fetch_word(self.surah, self.ayah, self.pos, self.total), self.show_info, self.show_err)

    def show_info(self, info):
        self.info = info
        self.meaning.setText((info['meaning'] + ('  ·  ' + info['translit'] if info['translit'] else '')) if info['meaning'] else t('mus.q.nomeaning'))
        self.verse.setText(info['verse'])

    def show_err(self, m):
        self.meaning.setText(t('mus.q.offline') + '\n' + m)

    def tafsir(self, lang):
        self.tf.show()
        self.tf.setLayoutDirection(Qt.RightToLeft if lang == 'ar' else Qt.LeftToRight)
        self.tf.setPlainText('…')
        run_async(lambda: fetch_tafsir(self.surah, self.ayah, lang), self.tf.setPlainText, lambda m: self.tf.setPlainText(t('mus.q.offline') + '\n' + m))
