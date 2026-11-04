"""Business-intelligence layer: turns workflow instances into ERP documents and computes the dashboard KPIs and report tables.
A direct port of the portal's erp-data.service.ts; the mappings live in data/dashboard.json (shared by all desktop apps)."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'dashboard.json').read_text(encoding='utf-8'))
STAGES = SPEC['stages']
COLORS = SPEC['modules']
_DT = {d['key']: d for d in SPEC['docTypes']}
_BY_WF = {d['workflow']: d for d in SPEC['docTypes']}
_REJ = re.compile(SPEC['rejectActions'], re.I)


def parse(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def now():
    return datetime.now(timezone.utc)


def num(v):
    try:
        return None if v in (None, '') else float(v)
    except (TypeError, ValueError):
        return None


def stage_for_node(n):
    if not n:
        return 'request'
    if n in SPEC['nodeStage']:
        return SPEC['nodeStage'][n]
    low = n.lower()
    for st, rx in SPEC['stageKeywords']:
        if re.search(rx, low):
            return st
    return 'request'


def module_for(wf):
    if wf in _BY_WF:
        return _BY_WF[wf]['module']
    low = (wf or '').lower()
    for m, rx in SPEC['moduleKeywords']:
        if re.search(rx, low):
            return m
    return 'operations'


def outcome(i):
    if i.get('status') == 'Running':
        return 'pending'
    if i.get('status') == 'Terminated':
        return 'canceled'
    for h in i.get('history') or []:
        if _REJ.match(h.get('action') or '') or (h.get('action') == 'Entered' and re.search('reject', h.get('nodeName') or '', re.I)):
            return 'rejected'
    return 'approved'


def to_doc(i):
    data = i.get('data') or {}
    dt = _DT.get(data.get('docType')) or _BY_WF.get(i.get('definitionName'))
    status = outcome(i)
    hist = i.get('history') or []
    last = next((h for h in reversed(hist) if h.get('action') == 'Entered' and not re.fullmatch('start|end|completed|rejected', h.get('nodeName') or '', re.I)), None)
    if status == 'approved':
        stage, step = 'reporting', 'Completed'
    elif status == 'pending':
        stage, step = stage_for_node(last and last.get('nodeName')), (last or {}).get('nodeName') or 'Start'
    else:
        stage, step = stage_for_node(last and last.get('nodeName')), 'Rejected' if status == 'rejected' else 'Canceled'
    start = parse(i.get('startedAt')) or now()
    done = parse(i.get('completedAt'))
    return dict(id=i.get('id', ''), inst=i, type=dt['key'] if dt else '', module=dt['module'] if dt else module_for(i.get('definitionName')),
                number=data.get('docNumber') or 'WF-' + str(i.get('id', ''))[:6].upper(), title=i.get('definitionName', ''),
                party=data.get('party') or data.get('employeeName') or data.get('candidateName') or '', total=num(data.get('total')),
                currency=data.get('currency') or '', branch=data.get('branch') or '', date=start, completed=done, status=status, stage=stage, step=step,
                by=i.get('startedBy', ''), age=max(0.0, ((done or now()) - start).total_seconds() / 86400),
                lines=data.get('lines') if isinstance(data.get('lines'), list) else [])


def docs_of(instances):
    return sorted((to_doc(i) for i in instances), key=lambda d: d['date'], reverse=True)


def _in_month(d):
    n = now()
    return bool(d) and d.month == n.month and d.year == n.year


def kpis(docs, my_tasks=0):
    S = lambda l: sum(d['total'] or 0 for d in l)
    of = lambda *k: [d for d in docs if d['type'] in k]
    done = [d for d in docs if d['status'] == 'approved']
    closed = [d for d in docs if d['status'] in ('approved', 'rejected')]
    return dict(
        salesMonth=S([d for d in of('SO') if d['status'] == 'approved' and _in_month(d['completed'])]),
        purchasesMonth=S([d for d in of('PR') if d['status'] == 'approved' and _in_month(d['completed'])]),
        expensesMonth=S([d for d in of('EXP', 'PV') if d['status'] == 'approved' and _in_month(d['completed'])]),
        receivables=S([d for d in of('SO') if d['status'] == 'pending' and d['stage'] == 'accounting']),
        payables=S([d for d in of('PR', 'PV', 'EXP') if d['status'] == 'pending' and d['stage'] == 'accounting']),
        pipeline=S([d for d in of('SO') if d['status'] == 'pending']),
        committed=S([d for d in of('PR') if d['status'] == 'pending' and d['stage'] in ('purchase', 'inventory')]),
        inTransit=S([d for d in of('TRF') if d['status'] == 'pending' and d['stage'] == 'inventory']),
        openDocs=len([d for d in docs if d['status'] == 'pending']),
        completedMonth=len([d for d in done if _in_month(d['completed'])]),
        avgCycleDays=sum(d['age'] for d in done) / len(done) if done else 0.0,
        rejectRate=len([d for d in docs if d['status'] == 'rejected']) / len(closed) if closed else 0.0,
        myApprovals=my_tasks)


def monthly_trend(docs, months=6):
    n = now(); out = []
    for k in range(months - 1, -1, -1):
        y, m = n.year, n.month - k
        while m < 1:
            m += 12; y -= 1
        out.append(dict(year=y, month=m, sales=0.0, purchases=0.0))
    for d in docs:
        if d['status'] != 'approved' or not d['completed'] or d['total'] is None:
            continue
        b = next((o for o in out if o['year'] == d['completed'].year and o['month'] == d['completed'].month), None)
        if b:
            if d['type'] == 'SO': b['sales'] += d['total']
            if d['type'] == 'PR': b['purchases'] += d['total']
    return out


def stage_counts(docs):
    r = {s: dict(count=0, value=0.0) for s in STAGES}
    for d in docs:
        if d['status'] in ('pending', 'approved'):
            s = d['stage'] if d['status'] == 'pending' else 'reporting'
            r[s]['count'] += 1; r[s]['value'] += d['total'] or 0
    n = now()
    raised = [d for d in docs if d['date'].month == n.month and d['date'].year == n.year]
    r['request'] = dict(count=len(raised), value=sum(d['total'] or 0 for d in raised))
    return r


def step_turnaround(docs):
    acc = {}
    for d in docs:
        h = d['inst'].get('history') or []
        for k, e in enumerate(h):
            if e.get('action') != 'Entered':
                continue
            dec = next((x for x in h[k + 1:] if x.get('nodeId') == e.get('nodeId') and x.get('action') not in ('Entered', 'Logged') and x.get('actor') != 'system'), None)
            a, b = parse(e.get('timestamp')), dec and parse(dec.get('timestamp'))
            if not (a and b):
                continue
            v = acc.setdefault(e.get('nodeName'), [0.0, 0]); v[0] += (b - a).total_seconds() / 3600; v[1] += 1
    return sorted(({'step': s, 'avgHours': v[0] / v[1], 'count': v[1]} for s, v in acc.items()), key=lambda x: -x['avgHours'])


def top_parties(docs, keys, limit=5):
    m = {}
    for d in docs:
        if d['type'] in keys and d['party'] and d['status'] not in ('canceled', 'rejected'):
            e = m.setdefault(d['party'], [0.0, 0]); e[0] += d['total'] or 0; e[1] += 1
    return sorted(({'party': p, 'value': v[0], 'count': v[1]} for p, v in m.items()), key=lambda x: -x['value'])[:limit]


def group_by(docs, key):
    """Rows for the 'by module' / 'by branch' report tables."""
    g = {}
    for d in docs:
        k = d[key] or '—'
        r = g.setdefault(k, dict(key=k, count=0, pending=0, approved=0, rejected=0, days=0.0, ndone=0, value=0.0))
        r['count'] += 1; r['value'] += d['total'] or 0
        if d['status'] in ('pending', 'approved', 'rejected'): r[d['status']] += 1
        if d['status'] == 'approved': r['days'] += d['age']; r['ndone'] += 1
    return sorted(({**r, 'avgDays': r['days'] / r['ndone'] if r['ndone'] else 0.0} for r in g.values()), key=lambda r: -r['count'])


def bottleneck(docs):
    m = {}
    for d in docs:
        if d['status'] == 'pending':
            m[d['step']] = m.get(d['step'], 0) + 1
    return sorted(({'step': k, 'count': v} for k, v in m.items()), key=lambda x: -x['count'])
