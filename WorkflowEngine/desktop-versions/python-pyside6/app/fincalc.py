"""Finance calculations (port of the portal's fin.calc.ts): trial balance, statements, ageing, depreciation, budgets, projects.
Records are the API's finance rows: {id, kind, code, company, status, data{...}}."""
from datetime import date


def num(v):
    try:
        n = float(v)
        return n if n == n and abs(n) != float('inf') else 0.0
    except (TypeError, ValueError):
        return 0.0


def r2(n):
    return round(n + 1e-9 if n >= 0 else n - 1e-9, 2)


def posted_lines(journals, company='', frm='', to='', statuses=('Posted',)):
    out = []
    for j in journals:
        if (j.get('status') or '') not in statuses:
            continue
        d = j.get('data') or {}
        dt = str(d.get('date') or '')[:10]
        if not dt or (frm and dt < frm) or (to and dt > to):
            continue
        co = j.get('company') or ''
        if company and company != 'ALL' and co and co != company:
            continue
        rate = num(d.get('rate')) if num(d.get('rate')) > 0 else 1
        for l in d.get('lines') or []:
            out.append(dict(journal=j.get('code') or '', date=dt, company=co, account=l.get('account'), debit=r2(num(l.get('debit')) * rate), credit=r2(num(l.get('credit')) * rate),
                            cc=l.get('costCenter') or '', project=l.get('project') or ''))
    return out


def acc_name(a, ar=False):
    d = a.get('data') or {}
    return (d.get('nameAr') if ar and d.get('nameAr') else d.get('name')) or a.get('code') or ''


def trial_balance(lines, accounts, ar=False):
    sums = {}
    for l in lines:
        s = sums.setdefault(l['account'], [0.0, 0.0])
        s[0] += l['debit']
        s[1] += l['credit']
    rows, seen = [], set()
    for a in sorted(accounts, key=lambda x: x.get('code') or ''):
        code = a.get('code') or ''
        seen.add(code)
        s = sums.get(code)
        if not s:
            continue
        typ = str((a.get('data') or {}).get('type') or '')
        dn = typ in ('Asset', 'Expense')
        rows.append(dict(account=code, name=acc_name(a, ar), type=typ, debit=r2(s[0]), credit=r2(s[1]), balance=r2(s[0] - s[1] if dn else s[1] - s[0])))
    for code, s in sums.items():
        if code not in seen:
            rows.append(dict(account=code, name=code, type='', debit=r2(s[0]), credit=r2(s[1]), balance=r2(s[0] - s[1])))
    return rows


def income_statement(tb):
    rev = [r for r in tb if r['type'] == 'Revenue']
    exp = [r for r in tb if r['type'] == 'Expense']
    tr, te = r2(sum(r['balance'] for r in rev)), r2(sum(r['balance'] for r in exp))
    return dict(revenue=rev, expense=exp, total_revenue=tr, total_expense=te, net=r2(tr - te))


def balance_sheet(tb):
    a = [r for r in tb if r['type'] == 'Asset']
    l = [r for r in tb if r['type'] == 'Liability']
    e = [r for r in tb if r['type'] == 'Equity']
    ni = income_statement(tb)['net']
    ta, tl = r2(sum(r['balance'] for r in a)), r2(sum(r['balance'] for r in l))
    te = r2(sum(r['balance'] for r in e) + ni)
    return dict(assets=a, liabilities=l, equity=e, net_income=ni, total_assets=ta, total_liabilities=tl, total_equity=te, check=r2(ta - tl - te))


def invoice_total(d):
    return num(d.get('total')) if num(d.get('total')) > 0 else num(d.get('amount')) + num(d.get('taxAmount'))


def outstanding(r):
    d = r.get('data') or {}
    return r2((invoice_total(d) - num(d.get('paid'))) * (num(d.get('rate')) if num(d.get('rate')) > 0 else 1))


def days_late(r, today):
    d = r.get('data') or {}
    due = str(d.get('dueDate') or d.get('date') or today)[:10]
    return (date.fromisoformat(today) - date.fromisoformat(due)).days


def bucket(late):
    return 0 if late <= 0 else 1 if late <= 30 else 2 if late <= 60 else 3 if late <= 90 else 4


def aging(invoices, party_key, open_statuses, today):
    m = {}
    for r in invoices:
        if (r.get('status') or '') not in open_statuses:
            continue
        amt = outstanding(r)
        if amt <= 0:
            continue
        p = str((r.get('data') or {}).get(party_key) or '—')
        b = m.setdefault(p, [0.0] * 5)
        b[bucket(days_late(r, today))] += amt
    parties = sorted(({'party': p, 'buckets': [r2(x) for x in b], 'total': r2(sum(b))} for p, b in m.items()), key=lambda x: -x['total'])
    return parties, [r2(sum(p['buckets'][i] for p in parties)) for i in range(5)]


def next_month(p):
    y, m = map(int, p.split('-'))
    return f'{y + 1}-01' if m == 12 else f'{y}-{m + 1:02d}'


def asset_calc(d):
    cost, salvage, acc = num(d.get('cost')), num(d.get('salvage')), num(d.get('accumulated'))
    life = max(1, round(num(d.get('lifeMonths')) or 60))
    nbv = r2(cost - acc)
    monthly = (nbv * (2 / life)) if d.get('method') == 'DB' else (cost - salvage) / life
    monthly = max(0.0, min(monthly, nbv - salvage))
    left = -(-(nbv - salvage) // max(monthly, 0.01)) if monthly > 0 else 0
    return dict(cost=cost, accumulated=acc, nbv=nbv, monthly=r2(monthly), months_left=int(left))


def budget_vs_actual(budgets, lines, acc_type):
    out = []
    for b in budgets:
        d = b.get('data') or {}
        year, cc, acc = int(num(d.get('year'))), str(d.get('costCenter') or ''), str(d.get('account') or '')
        actual = r2(sum(l['debit'] - l['credit'] for l in lines if l['date'].startswith(str(year)) and acc_type(l['account']) == 'Expense'
                        and (not cc or l['cc'] == cc) and (not acc or l['account'] == acc)))
        budget = num(d.get('amount'))
        out.append(dict(cc=cc, account=acc, year=year, budget=budget, actual=actual, remaining=r2(budget - actual), used=round(actual / budget * 100) if budget > 0 else 0))
    return out


def project_results(projects, lines, acc_type):
    out = []
    for p in projects:
        mine = [l for l in lines if l['project'] == p.get('code')]
        rev = r2(sum(l['credit'] - l['debit'] for l in mine if acc_type(l['account']) == 'Revenue'))
        cost = r2(sum(l['debit'] - l['credit'] for l in mine if acc_type(l['account']) == 'Expense'))
        out.append(dict(code=p.get('code') or '', revenue=rev, cost=cost, profit=r2(rev - cost), margin=round((rev - cost) / rev * 100) if rev > 0 else 0))
    return out
