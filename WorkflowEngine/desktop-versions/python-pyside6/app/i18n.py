import json
from pathlib import Path

_DATA = Path(__file__).resolve().parent.parent / 'data'
_dict = json.loads((_DATA / 'i18n.json').read_text(encoding='utf-8'))
catalog = json.loads((_DATA / 'catalog.json').read_text(encoding='utf-8'))['modules']
lang = 'en'


def set_lang(l):
    global lang
    lang = 'ar' if l == 'ar' else 'en'


def rtl():
    return lang == 'ar'


def t(key, **vars):
    s = _dict.get(lang, {}).get(key) or _dict['en'].get(key) or key
    for k, v in vars.items():
        s = s.replace('{' + k + '}', str(v))
    return s


def name(o):
    return o['ar'] if rtl() else o['en']
