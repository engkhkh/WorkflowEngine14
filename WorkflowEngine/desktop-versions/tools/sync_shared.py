#!/usr/bin/env python3
"""Copies shared JSON specs into every desktop app and merges portal i18n keys into every i18n.json.
usage: sync_shared.py spec <file.json>        copy shared/<file.json> into each app's data folder
       sync_shared.py i18n <regex-of-keys>    merge matching keys from the portal dictionary (en+ar) into shared/i18n.json and all copies
       sync_shared.py i18n-add <json-file>    merge {"key":["en","ar"],...} into all copies"""
import json, re, shutil, sys
from pathlib import Path
R = Path(__file__).resolve().parent.parent
DATA = [R/'python-pyside6/data', R/'cpp-qt/data', R/'csharp-wpf/data', R/'java-swing/src/main/resources', R/'java-swing/out']
I18N = [R/'shared/i18n.json'] + [d/'i18n.json' for d in DATA]
PORTAL = R.parent/'portal-app/src/app/core/i18n/dictionary.ts'

def merge(pairs):
    for p in I18N:
        if not p.parent.exists(): continue
        j = json.loads(p.read_text(encoding='utf-8'))
        for k, (en, ar) in pairs.items(): j['en'][k] = en; j['ar'][k] = ar
        p.write_text(json.dumps(j, ensure_ascii=False, indent=1), encoding='utf-8')

if sys.argv[1] == 'spec':
    for d in DATA:
        if d.parent.exists() or d.exists():
            d.mkdir(parents=True, exist_ok=True); shutil.copy(R/'shared'/sys.argv[2], d/sys.argv[2])
elif sys.argv[1] == 'i18n':
    t = PORTAL.read_text(encoding='utf-8'); pairs = {}
    for m in re.finditer(r'"(' + sys.argv[2] + r')":\s*\{\s*en:\s*"((?:[^"\\]|\\.)*)",\s*ar:\s*"((?:[^"\\]|\\.)*)"', t):
        pairs[m.group(1)] = (m.group(2).replace('\\"', '"'), m.group(3).replace('\\"', '"'))
    merge(pairs); print(len(pairs), 'keys merged')
elif sys.argv[1] == 'i18n-add':
    merge({k: tuple(v) for k, v in json.loads(Path(sys.argv[2]).read_text(encoding='utf-8')).items()}); print('added')
