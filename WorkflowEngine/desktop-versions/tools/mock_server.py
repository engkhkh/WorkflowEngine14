"""A tiny fake of the Workflow ERP API, for trying the desktop apps without the real backend.
   python3 mock_server.py [port]      login: admin / admin"""
import json, sys, re, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

cat = json.loads((Path(__file__).parent.parent / 'shared' / 'catalog.json').read_text(encoding='utf-8'))
perms = {'gov.view'}
for m in cat['modules']:
    for k in m['kinds']:
        perms.add(k['view']); perms.add(k['manage'])
perms.update(['finance.gl.approve', 'finance.gl.manage', 'finance.assets.manage', 'mfg.orders.manage', 'mfg.orders.execute', 'hr.reports.view', 'hr.employees.view', 'hr.employees.manage', 'hr.employees.import', 'hr.employees.salary', 'hr.leave.view', 'hr.leave.approve', 'hr.performance.view', 'hr.recruitment.view', 'hr.recruitment.manage', 'hr.org.view', 'finance.reports.view', 'finance.gl.view', 'finance.ar.view', 'finance.ap.view', 'finance.budget.view', 'finance.projects.view', 'finance.assets.view', 'finance.bank.view', 'finance.bank.manage', 'finance.audit.view', 'finance.setup', 'org.manage', 'admin.users', 'web.view', 'web.edit', 'web.publish', 'web.orders.manage', 'cus.view', 'cus.manage', 'cus.design', 'gov.vat.view', 'gov.zatca.manage', 'cal.view', 'cal.settings', 'cal.events.manage', 'pos.sell','pos.refund','pos.void','pos.discount','pos.shifts.manage','wf.view', 'wf.design', 'wf.publish', 'wf.instances.view'])
perms = sorted(perms)
DB = {}   # (module, kind) -> list
def seed():
    DB[('crm', 'lead')] = [dict(id=str(uuid.uuid4()), module='crm', kind='lead', code='LD-0001', company='C1', status='New', ref=None, createdBy='admin', data={'name': 'Acme Trading', 'amount': 12000, 'hot': True, 'notes': {'a': 1}})]
    DB[('proc', 'po')] = [dict(id=str(uuid.uuid4()), module='proc', kind='po', code='PO-0001', company='C1', status='Draft', ref=None, createdBy='admin', data={'name': 'Office chairs', 'total': 4500})]
    DB[('gov', 'approval')] = [dict(id=str(uuid.uuid4()), module='gov', kind='approval', code='APR-1', company='C1', status='Pending', ref=None, createdBy='sara', data={'target': 'proc/po', 'code': 'PO-0001', 'amount': 4500, 'requestedBy': 'sara', 'canAct': True, 'current': 0})]
    pass
    pass
    pass
def _pos_seed():
    def rec(kind, code, data, status='Active', **kw):
        return dict(id=str(uuid.uuid4()), module='pos', kind=kind, code=code, company='C1', branch=kw.get('branch', 'B1'), status=status, ref=kw.get('ref'), parent=kw.get('parent'), createdBy='admin', createdAt=kw.get('at', '2026-11-01T08:00:00Z'), data=data)
    prods = [('P-100', 'Coffee beans 1kg', 55, 'Coffee', 1), ('P-101', 'Espresso cup', 12, 'Cafe', 0), ('P-102', 'Milk 1L', 7.5, 'Dairy', 1), ('P-103', 'Croissant', 9, 'Bakery', 1),
             ('P-104', 'Green tea box', 28, 'Tea', 1), ('P-105', 'Sugar sticks', 4, 'Cafe', 0), ('P-106', 'Water 500ml', 2, 'Drinks', 1), ('P-107', 'Chocolate bar', 6.5, 'Snacks', 1)]
    DB[('pos', 'product')] = [rec('product', c, dict(name=n, price=p, category=cat, trackStock=bool(ts), barcode='6000' + c[-3:])) for c, n, p, cat, ts in prods]
    DB[('pos', 'category')] = [rec('category', c, dict(name=c, nameAr=c)) for c in ('Coffee', 'Cafe', 'Dairy', 'Bakery', 'Tea', 'Drinks', 'Snacks')]
    DB[('pos', 'customer')] = [rec('customer', 'CU-001', dict(name='Omar Khalid', points=120, discountPct=5)), rec('customer', 'CU-002', dict(name='Laila Nasser', points=0, discountPct=0))]
    DB[('pos', 'promotion')] = [rec('promotion', 'PR-10', dict(name='Tea 10%', scope='sku', target='P-104', type='pct', value=10))]
    DB[('pos', 'register')] = [rec('register', 'R1', dict(name='Front till'))]
    DB[('pos', 'setting')] = [rec('setting', 'pos', dict(taxRate=15, pricesIncludeTax=True, pointsPerCurrency=1, pointValue=0.05, requireShift=True, allowNegativeStock=False, maxDiscountPct=20, receiptHeader='Demo Co - Riyadh', receiptFooter='Keep your receipt'))]
    DB[('pos', 'stock')] = [rec('stock', c, dict(sku=c, qty=40 if c != 'P-103' else 3)) for c, *_ in prods]
    DB[('pos', 'shift')] = []
    DB[('pos', 'sale')] = []
_pos_seed()
POSN = {'sale': 0, 'ret': 0, 'shift': 0}

def _r2(n): return round(n + 1e-9, 2)

# ---- hospital (clinical) mock ----
from urllib.parse import urlparse, parse_qs
HN = {'v': 0, 'i': 0, 'rx': 0, 'lab': 0, 'adm': 0, 'ap': 0}
def _hrec(kind, code, data, status='Active', parent=None, ref=None):
    return dict(id=str(uuid.uuid4()), module='hos', kind=kind, code=code, company=None, branch='B1', status=status, ref=ref, parent=parent, createdBy='admin', createdAt='2026-11-03T08:00:00Z', data=data)
def _hos_seed():
    H = lambda k: DB.setdefault(('hos', k), [])
    DB[('hos', 'patient')] = [_hrec('patient', 'MRN-000001', dict(name='Sara Ahmed', sex='Female', dob='1990-04-02', phone='0500000001', allergies='penicillin')), _hrec('patient', 'MRN-000002', dict(name='Omar Ali', sex='Male', dob='1985-01-20', phone='0500000002', allergies=''))]
    DB[('hos', 'doctor')] = [_hrec('doctor', 'DR-01', dict(name='Dr. Hana Saleh', slot=20, **{'from': '08:00', 'to': '17:00'}))]
    DB[('hos', 'drug')] = [_hrec('drug', 'DG-01', dict(name='Amoxicillin', strength='500mg', form='Capsule', price=12, stock=50, reorder=10, cls='penicillin')), _hrec('drug', 'DG-02', dict(name='Paracetamol', strength='500mg', form='Tablet', price=3, stock=5, reorder=10, cls=''))]
    DB[('hos', 'labtest')] = [_hrec('labtest', 'LT-01', dict(name='CBC', sample='Blood', unit='g/dL', price=40))]
    DB[('hos', 'service')] = [_hrec('service', 'SV-01', dict(name='Consultation', price=100))]
    DB[('hos', 'bed')] = [_hrec('bed', 'BD-01', dict(name='Bed 1', wardName='Ward A'), 'Available'), _hrec('bed', 'BD-02', dict(name='Bed 2', wardName='Ward A'), 'Available')]
    for k in ('appointment', 'visit', 'prescription', 'labrequest', 'admission', 'invoice'): DB[('hos', k)] = []
_hos_seed()
def _frec(kind, code, data, status=None, company='C1'): return dict(id=str(uuid.uuid4()), module='fin', kind=kind, code=code, company=company, status=status, createdBy='admin', data=data)
def _fin_seed():
    A = lambda c, n, t: _frec('account', c, dict(name=n, type=t), 'Active')
    DB[('fin', 'account')] = [A('1000', 'Cash', 'Asset'), A('1100', 'Receivables', 'Asset'), A('2000', 'Payables', 'Liability'), A('3000', 'Capital', 'Equity'), A('4000', 'Sales', 'Revenue'), A('5000', 'Operating expense', 'Expense')]
    J = lambda c, dt, st, lines: _frec('journal', c, dict(date=dt, lines=lines), st)
    DB[('fin', 'journal')] = [J('JV-1', '2026-01-10', 'Posted', [dict(account='1000', debit=10000, credit=0), dict(account='3000', debit=0, credit=10000)]),
        J('JV-2', '2026-02-05', 'Posted', [dict(account='1100', debit=5000, credit=0), dict(account='4000', debit=0, credit=5000, project='P1')]),
        J('JV-3', '2026-02-20', 'Posted', [dict(account='5000', debit=1200, credit=0, costCenter='CC1', project='P1'), dict(account='1000', debit=0, credit=1200)]),
        J('JV-4', '2026-03-01', 'Draft', [dict(account='5000', debit=999, credit=0), dict(account='1000', debit=0, credit=999)])]
    DB[('fin', 'arinvoice')] = [_frec('arinvoice', 'AR-1', dict(customer='Alpha', amount=1000, taxAmount=150, paid=150, dueDate='2020-01-01'), 'Issued'), _frec('arinvoice', 'AR-2', dict(customer='Alpha', amount=500, dueDate='2999-01-01'), 'Issued'),
        _frec('arinvoice', 'AR-3', dict(customer='Beta', amount=70, dueDate='2020-01-01'), 'Paid')]
    DB[('fin', 'apinvoice')] = [_frec('apinvoice', 'AP-1', dict(vendor='Supply Co', amount=300, dueDate='2999-01-01', poNo='PO-1', poAmount=300, receivedAmount=300, date='2026-10-05', invoiceNo='S-77'), 'Approved'), _frec('apinvoice', 'AP-2', dict(vendor='Supply Co', amount=900, poNo='PO-2', poAmount=500, receivedAmount=0, date='2026-10-06', invoiceNo='S-78'), 'Submitted')]
    DB[('fin', 'budget')] = [_frec('budget', 'BU-1', dict(year=2026, costCenter='CC1', account='5000', amount=2000))]
    DB[('fin', 'project')] = [_frec('project', 'P1', dict(name='Project one'), 'Active')]
    DB[('fin', 'setting')] = [_frec('setting', 'defaults', dict(deprExpense='6100', deprAccum='1590', arAccount='1100', revenueAccount='4000', vatOutput='2200', apAccount='2000', expenseAccount='5000', vatInput='1300'), 'Active')]
    DB[('fin', 'period')] = [_frec('period', '2026-10', {}, 'Open')]
    DB[('fin', 'asset')] = [_frec('asset', 'FA-1', dict(name='Delivery van', cost=12000, salvage=0, accumulated=2000, lifeMonths=60, method='SL', inServiceDate='2026-01-01'), 'Active')]
    DB[('fin', 'bankaccount')] = [_frec('bankaccount', 'B1', dict(name='Main bank', openingBalance=1000))]
    DB[('fin', 'banktxn')] = [_frec('banktxn', 'BT-1', dict(account='B1', date='2026-02-01', description='Deposit', amount=500, reconciled=False)), _frec('banktxn', 'BT-2', dict(account='B1', date='2026-02-02', description='Fee', amount=-200, reconciled=True))]
_fin_seed()
def _hrr(kind, code, data, status=None, emp=None): return dict(id=str(uuid.uuid4()), module='hr', kind=kind, code=code, empNo=emp, company=None, status=status, ref=None, createdBy='admin', data=data)
def _hr_seed():
    EMP.append(dict(id='e2', empNo='E002', status='Active', fullName='Omar Khalid', unit='Finance', position='Accountant', hireDate='2024-02-01', basicSalary=7000))
    EMP[0].update(unit='Finance', position='Senior Accountant', hireDate='2022-01-15')
    DB[('hr', 'leavetype')] = [_hrr('leavetype', 'ANN', dict(name='Annual', days=21))]
    DB[('hr', 'leave')] = [_hrr('leave', 'LV-0001', dict(type='ANN', **{'from': '2026-11-10', 'to': '2026-11-12'}, days=3, reason='trip'), 'Pending', 'E001'), _hrr('leave', 'LV-0002', dict(type='ANN', **{'from': '2026-03-01', 'to': '2026-03-05'}, days=5), 'Approved', 'E001')]
    DB[('hr', 'vacancy')] = [_hrr('vacancy', 'VAC-1', dict(title='Accountant'), 'Open')]
    DB[('hr', 'candidate')] = [_hrr('candidate', 'CA-1', dict(name='Lina Hassan', email='lina@x.com', vacancy='VAC-1'), 'Applied'), _hrr('candidate', 'CA-2', dict(name='Zaid Noor', email='zaid@x.com', vacancy='VAC-1'), 'Offer')]
    DB[('hr', 'review')] = [_hrr('review', 'RV-1', dict(stage='Final', rating=4), 'Done', 'E001'), _hrr('review', 'RV-2', dict(stage='Final', rating=5), 'Done', 'E002'), _hrr('review', 'RV-3', dict(stage='Mid-year', rating=4), 'Done', 'E002')]
    DB[('hr', 'unit')] = [_hrr('unit', 'FIN', dict(name='Finance', level='department', parent='')), _hrr('unit', 'ACC', dict(name='Accounting', level='section', parent='FIN'))]
def hr_route(h, method, p):
    if p == '/api/hr/summary': return h.send(200, dict(total=len(EMP), active=len(EMP), onLeave=0, probation=0, terminated=0, newHires12m=1, terminations12m=0, turnoverPct=0, avgTenureYears=2.5, monthlyPayroll=16000, onLeaveToday=0, pendingLeave=1, openVacancies=1, openPositions=1, candidatesInPipeline=2))
    if p == '/api/hr/employees/import' and method == 'POST':
        b = h.body(); res = dict(created=0, updated=0, skipped=0, errors=[])
        for r in b.get('rows', []):
            d = r['data']; ex = next((e for e in EMP if e['empNo'].lower() == d['empNo'].lower()), None)
            if d['empNo'] == 'BAD': res['errors'].append(dict(row=r['row'], empNo=d['empNo'], message='rejected by server')); continue
            if ex and not b.get('updateExisting'): res['skipped'] += 1
            elif ex: ex.update(d); res['updated'] += 1
            else: d['id'] = 'e%d' % (len(EMP) + 1); EMP.append(d); res['created'] += 1
        return h.send(200, res)
    return False
FIN_AUDIT = [dict(id='a1', kind='journal', recordId='x', code='JV-1', action='Posted', userName='admin', at='2026-01-10T09:00:00Z', summary='Posted journal JV-1')]
def fin_route(h, method, p):
    if p == '/api/finance/summary': return h.send(200, dict(revenueYtd=5000, expenseYtd=1200, profitYtd=3800, cash=8800, arOutstanding=1500, arOverdue=1000, apOutstanding=300, apOverdue=0, budgetTotal=2000, budgetActual=1200, journalsToApprove=1, invoicesToApprove=0, assetCount=1, assetCost=12000, assetAccumulated=2000, activeProjects=1, currentPeriod='2026-11', currentPeriodStatus='Open'))
    if p == '/api/finance/audit': return h.send(200, FIN_AUDIT)
    if p == '/api/finance/accounts/seed' and method == 'POST': return h.send(200, dict(created=0))
    return False
def _hfind(kind, rid): return next((r for r in DB[('hos', kind)] if r['id'] == rid or r['code'] == rid), None)
def _hinv(visit):
    inv = next((i for i in DB[('hos', 'invoice')] if i['parent'] == visit['code']), None)
    if not inv:
        HN['i'] += 1; inv = _hrec('invoice', 'INV-%04d' % HN['i'], dict(patientName=visit['data']['patientName'], lines=[], total=0, insurance=0, due=0, paid=0, balance=0, payments=[]), 'Open', visit['code'])
        DB[('hos', 'invoice')].append(inv)
    return inv
def _hline(visit, desc, qty, price):
    inv = _hinv(visit); d = inv['data']; d['lines'].append(dict(desc=desc, qty=qty, price=price, amount=_r2(qty * price)))
    d['total'] = _r2(sum(l['amount'] for l in d['lines'])); d['due'] = d['total']; d['balance'] = _r2(d['total'] - d['paid'])
def _newvisit(pcode, dcode, typ, complaint):
    pat = _hfind('patient', pcode); doc = _hfind('doctor', dcode) if dcode else None
    if not pat: return None
    HN['v'] += 1
    v = _hrec('visit', 'V-%05d' % HN['v'], dict(patientName=pat['data']['name'], doctorName=doc['data']['name'] if doc else '', complaint=complaint or '', type=typ or 'Outpatient', vitals={}, diagnoses=[], notes={}), 'Open', pat['code'])
    DB[('hos', 'visit')].append(v); return v
# ---- calendar mock ----
import datetime as _dt
CAL = {'items': [], 'n': 0, 'settings': {'jitsiDomain': 'meet.jit.si', 'workStart': '09:00', 'workEnd': '17:00'}}
def _iso(d): return d.strftime('%Y-%m-%dT%H:%M:%SZ')
def _pd(s): return _dt.datetime.strptime(s[:19], '%Y-%m-%dT%H:%M:%S') if s else None
def _cal_seed():
    now = _dt.datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=0)
    CAL['n'] = 3
    CAL['items'] = [
        dict(id='ev1', kind='event', title='Team stand-up', owner='admin', start=_iso(now), end=_iso(now + _dt.timedelta(minutes=30)), status=None, room=None, data=dict(notes='', location='Room 1', allDay=False, attendees=[], guests=[], repeat='daily', repeatUntil=None, remind=10, rsvp={})),
        dict(id='ev2', kind='meeting', title='Budget review', owner='sara', start=_iso(now + _dt.timedelta(hours=3)), end=_iso(now + _dt.timedelta(hours=4)), status=None, room='room-ev2', data=dict(notes='Q4', location='', allDay=False, attendees=['admin', 'sara'], guests=[], repeat='none', repeatUntil=None, remind=15, rsvp={})),
        dict(id='td1', kind='todo', title='Send report', owner='admin', start=_iso(now + _dt.timedelta(days=1)), end=None, status='Open', room=None, data=dict(notes='', priority='high', attendees=[], guests=[], repeat='none', rsvp={}))]
_cal_seed()
def _occ(e, a, b):
    s, en = _pd(e['start']), _pd(e['end']) if e['end'] else None; rp = e['data'].get('repeat', 'none'); out = []
    if rp in (None, 'none'): return [e] if s and a <= s <= b else []
    until = _pd(e['data'].get('repeatUntil')) if e['data'].get('repeatUntil') else b; cur, i = s, 0
    while cur <= min(b, until) and i < 400:
        if cur >= a:
            o = dict(e, start=_iso(cur), end=_iso(cur + (en - s)) if en else None, occurrence=True); out.append(o)
        i += 1
        cur = s + _dt.timedelta(days=i) if rp == 'daily' else s + _dt.timedelta(weeks=i) if rp == 'weekly' else (s.replace(year=s.year + (s.month - 1 + i) // 12, month=(s.month - 1 + i) % 12 + 1, day=min(s.day, 28)))
    return out
def cal_route(h, method, p, qs):
    if not p.startswith('/api/calendar/'): return False
    s = p[len('/api/calendar/'):]; S = h.send; q = {k: v[0] for k, v in qs.items()}
    B = h.body if method in ('POST', 'PUT') else (lambda: {})
    if s == 'events' and method == 'GET':
        a, b = _pd(q['from']), _pd(q['to']); out = []
        for e in CAL['items']:
            if e['kind'] != 'todo': out += _occ(e, a, b)
        return S(200, sorted(out, key=lambda x: x['start']))
    if s == 'todos': return S(200, [e for e in CAL['items'] if e['kind'] == 'todo'])
    if s == 'people': return S(200, [dict(username='admin', displayName='Admin User'), dict(username='sara', displayName='Sara Ali'), dict(username='omar', displayName='Omar Khalid')])
    if s == 'settings': 
        if method == 'PUT': CAL['settings'].update(B())
        return S(200, CAL['settings'])
    if s == 'freebusy':
        b = B(); a0, b0 = _pd(b['from']), _pd(b['to']); out = {u: [] for u in b['users']}
        for e in CAL['items']:
            if e['kind'] == 'todo': continue
            for o in _occ(e, a0, b0):
                for u in out:
                    if u == e['owner'] or u in e['data'].get('attendees', []): out[u].append(dict(s=o['start'], e=o['end']))
        return S(200, out)
    if s == 'meetings/instant':
        b = B(); CAL['n'] += 1; i = 'ev%d' % CAL['n']; n = _dt.datetime.utcnow().replace(microsecond=0)
        e = dict(id=i, kind='meeting', title=b.get('title') or 'Meeting', owner='admin', start=_iso(n), end=_iso(n + _dt.timedelta(hours=1)), status=None, room='room-' + i, data=dict(attendees=b.get('attendees', []), guests=[], repeat='none', rsvp={}, notes='', location='', allDay=False))
        CAL['items'].append(e); return S(200, dict(ev=e, url='https://%s/%s' % (CAL['settings']['jitsiDomain'], e['room'])))
    if method == 'POST' and s == 'events':
        b = B()
        if not b.get('title'): return S(400, dict(message='Title is required'))
        CAL['n'] += 1; i = 'ev%d' % CAL['n']
        e = dict(id=i, kind=b['kind'], title=b['title'], owner='admin', start=b.get('start'), end=b.get('end'), status='Open' if b['kind'] == 'todo' else None, room='room-' + i if b['kind'] == 'meeting' else None,
                 data=dict(notes=b.get('notes', ''), location=b.get('location', ''), allDay=b.get('allDay', False), attendees=b.get('attendees', []), guests=b.get('guests', []), repeat=b.get('repeat', 'none'), repeatUntil=b.get('repeatUntil'), remind=b.get('remindMinutes'), priority=b.get('priority', 'normal'), rsvp={}))
        CAL['items'].append(e); return S(200, dict(ev=e, emailed=len(e['data']['guests'])))
    m = re.fullmatch(r'events/([\w-]+)(?:/(done|rsvp|join|ics))?', s)
    if m:
        e = next((x for x in CAL['items'] if x['id'] == m[1]), None)
        if not e: return S(404, dict(message='Not found'))
        act = m[2]
        if act is None and method == 'PUT':
            b = B(); e.update(kind=b['kind'], title=b['title'], start=b.get('start'), end=b.get('end')); e['data'].update(notes=b.get('notes', ''), location=b.get('location', ''), attendees=b.get('attendees', []), guests=b.get('guests', []), repeat=b.get('repeat', 'none'), repeatUntil=b.get('repeatUntil'), remind=b.get('remindMinutes'), priority=b.get('priority', 'normal'))
            return S(200, dict(ev=e, emailed=0))
        if act is None and method == 'DELETE': CAL['items'].remove(e); return S(204)
        if act == 'done': e['status'] = 'Open' if e['status'] == 'Done' else 'Done'; return S(200, e)
        if act == 'rsvp': e['data'].setdefault('rsvp', {})['admin'] = B().get('response'); return S(200, e)
        if act == 'join':
            if not e['room']: return S(400, dict(message='Only meetings have a room'))
            return S(200, dict(url='https://%s/%s' % (CAL['settings']['jitsiDomain'], e['room']), room=e['room'], domain=CAL['settings']['jitsiDomain'], title=e['title']))
        if act == 'ics':
            txt = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:%s\r\nSUMMARY:%s\r\nDTSTART:%s\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n' % (e['id'], e['title'], (e['start'] or '').replace('-', '').replace(':', ''))
            bb = txt.encode(); h.send_response(200); h.send_header('Content-Type', 'text/calendar'); h.send_header('Content-Length', str(len(bb))); h.end_headers(); h.wfile.write(bb); return None
    return False

def hos_route(h, method, p, qs):
    if not p.startswith('/api/hospital/'): return False
    s = p[len('/api/hospital/'):]; S = h.send; B = h.body if method in ('POST', 'PUT') else (lambda: {})
    q = {k: v[0] for k, v in qs.items()}
    if s == 'dashboard':
        ap = [a for a in DB[('hos', 'appointment')] if a['ref'] == q.get('today')]; beds = DB[('hos', 'bed')]; occ = sum(1 for b in beds if b['status'] == 'Occupied')
        return S(200, dict(patients=len(DB[('hos', 'patient')]), openVisits=sum(1 for v in DB[('hos', 'visit')] if v['status'] == 'Open'), admitted=sum(1 for a in DB[('hos', 'admission')] if a['status'] == 'Admitted'),
            pendingLabs=sum(1 for l in DB[('hos', 'labrequest')] if l['status'] == 'Ordered'), pendingRx=sum(1 for r in DB[('hos', 'prescription')] if r['status'] in ('Pending', 'Partial')),
            appointmentsToday=dict(total=len(ap), booked=sum(1 for a in ap if a['status'] == 'Booked'), checkedIn=sum(1 for a in ap if a['status'] == 'CheckedIn'), completed=sum(1 for a in ap if a['status'] == 'Completed'), cancelled=sum(1 for a in ap if a['status'] == 'Cancelled')),
            beds=dict(total=len(beds), occupied=occ, available=sum(1 for b in beds if b['status'] == 'Available'), maintenance=sum(1 for b in beds if b['status'] == 'Maintenance'), occupancyPct=round(100 * occ / max(1, len(beds)))),
            revenueToday=sum(i['data']['paid'] for i in DB[('hos', 'invoice')]), revenueWeek=sum(i['data']['paid'] for i in DB[('hos', 'invoice')]), outstanding=sum(i['data']['balance'] for i in DB[('hos', 'invoice')]),
            lowStock=[dict(code=d['code'], name=d['data']['name'], stock=d['data']['stock'], reorder=d['data']['reorder']) for d in DB[('hos', 'drug')] if d['data']['stock'] <= d['data']['reorder']],
            days=[], topDiagnoses=[]))
    m = re.fullmatch(r'patients/([\w-]+)/file', s)
    if m:
        pat = _hfind('patient', m[1]); 
        if not pat: return S(404, dict(message='Patient not found'))
        return S(200, dict(patient=pat['data'], visits=[dict(code=v['code'], status=v['status'], complaint=v['data']['complaint'], diagnoses=v['data']['diagnoses']) for v in DB[('hos', 'visit')] if v['parent'] == pat['code']],
            prescriptions=[r['code'] for r in DB[('hos', 'prescription')] if r['parent'] and _hfind('visit', r['parent']) and _hfind('visit', r['parent'])['parent'] == pat['code']]))
    m = re.fullmatch(r'records/(\w+)(?:/([\w-]+))?', s)
    if m and method == 'GET':
        kind, rid = m[1], m[2]; lst = DB.setdefault(('hos', kind), [])
        if rid: r = _hfind(kind, rid); return S(200, r) if r else S(404, dict(message='nf'))
        out = lst
        if q.get('status'): out = [r for r in out if r['status'] == q['status']]
        if q.get('parent'): out = [r for r in out if r['parent'] == q['parent']]
        if q.get('ref'): out = [r for r in out if r['ref'] == q['ref']]
        if q.get('q'): out = [r for r in out if q['q'].lower() in (r['code'] + json.dumps(r['data'], ensure_ascii=False)).lower()]
        return S(200, out[:int(q.get('take', 500))])
    if m: return False
    if method == 'POST' and s == 'visits':
        b = B(); v = _newvisit(b.get('patient'), b.get('doctor'), b.get('type'), b.get('complaint'))
        return S(200, v) if v else S(400, dict(message='Patient not found'))
    if method == 'POST' and s == 'appointments':
        b = B()
        if not b.get('patient') or not b.get('doctor') or not b.get('start'): return S(400, dict(message='Patient, doctor and time are required'))
        for a in DB[('hos', 'appointment')]:
            if a['parent'] == b['doctor'] and a['status'] in ('Booked', 'CheckedIn') and a['data']['start'] == b['start']: return S(409, dict(message='The doctor already has an appointment at this time'))
        pat = _hfind('patient', b['patient']); doc = _hfind('doctor', b['doctor']); HN['ap'] += 1
        a = _hrec('appointment', 'AP-%04d' % HN['ap'], dict(start=b['start'], minutes=b.get('minutes') or 20, reason=b.get('reason', ''), patient=pat['code'], patientName=pat['data']['name'], doctorName=doc['data']['name']), 'Booked', doc['code'], b['start'][:10])
        DB[('hos', 'appointment')].append(a); return S(200, a)
    m = re.fullmatch(r'appointments/([\w-]+)/status', s)
    if m and method == 'POST':
        a = _hfind('appointment', m[1]); b = B(); a['status'] = b['status']; out = dict(a)
        if b['status'] == 'CheckedIn':
            v = _newvisit(a['data']['patient'], a['parent'], 'Outpatient', a['data']['reason']); out['visit'] = v
        return S(200, out)
    m = re.fullmatch(r'visits/([\w-]+)(?:/(close|prescriptions|labs|services))?', s)
    if m and method in ('PUT', 'POST'):
        v = _hfind('visit', m[1]); b = B()
        if not v: return S(404, dict(message='Visit not found'))
        if v['status'] != 'Open': return S(409, dict(message='The visit is closed'))
        act = m[2]
        if act is None: v['data'].update({k: b[k] for k in ('complaint', 'vitals', 'diagnoses', 'notes') if k in b}); return S(200, v)
        if act == 'close': v['status'] = 'Closed'; return S(200, v)
        if act == 'services':
            sv = _hfind('service', b.get('service')); _hline(v, sv['data']['name'], b.get('qty') or 1, sv['data']['price']); return S(200, v)
        if act == 'labs':
            for c in b.get('tests', []):
                t = _hfind('labtest', c); HN['lab'] += 1
                DB[('hos', 'labrequest')].append(_hrec('labrequest', 'LB-%04d' % HN['lab'], dict(patientName=v['data']['patientName'], name=t['data']['name'], sample=t['data']['sample'], unit=t['data']['unit'], urgent=bool(b.get('urgent'))), 'Ordered', v['code']))
                _hline(v, t['data']['name'], 1, t['data']['price'])
            return S(200, dict(ok=True))
        if act == 'prescriptions':
            pat = _hfind('patient', v['parent']); items = []; warn = []
            for it in b.get('items', []):
                d = _hfind('drug', it['drug'])
                if d['data'].get('cls') and d['data']['cls'] in (pat['data'].get('allergies') or '').lower(): warn.append('Allergy: %s is a %s' % (d['data']['name'], d['data']['cls']))
                items.append(dict(drug=d['code'], name=d['data']['name'], strength=d['data']['strength'], dose=it.get('dose', ''), frequency=it.get('frequency', ''), days=it.get('days'), qty=it.get('qty') or 1, dispensed=0))
            if warn and not b.get('overrideReason'): return S(409, dict(message='Safety warnings need a reason to continue', warnings=warn))
            HN['rx'] += 1; r = _hrec('prescription', 'RX-%04d' % HN['rx'], dict(patientName=v['data']['patientName'], doctorName=v['data']['doctorName'], items=items, warnings=warn, overrideReason=b.get('overrideReason')), 'Pending', v['code'])
            DB[('hos', 'prescription')].append(r); return S(200, r)
    m = re.fullmatch(r'labrequests/([\w-]+)/result', s)
    if m and method == 'POST':
        l = _hfind('labrequest', m[1]); b = B(); l['data'].update(value=b.get('value'), note=b.get('note'), flag='Normal'); l['status'] = 'Resulted'; return S(200, l)
    m = re.fullmatch(r'prescriptions/([\w-]+)/(dispense|cancel)', s)
    if m and method == 'POST':
        r = _hfind('prescription', m[1]); b = B()
        if m[2] == 'cancel': r['status'] = 'Cancelled'; return S(200, r)
        for it in r['data']['items']:
            d = _hfind('drug', it['drug']); need = it['qty'] - it['dispensed']; give = min(need, d['data']['stock'])
            if give < need and not b.get('allowPartial'): return S(409, dict(message='Not enough stock for %s' % d['data']['name']))
            d['data']['stock'] -= give; it['dispensed'] += give
        r['status'] = 'Dispensed' if all(i['dispensed'] >= i['qty'] for i in r['data']['items']) else 'Partial'; return S(200, r)
    m = re.fullmatch(r'drugs/([\w-]+)/stock', s)
    if m and method == 'POST':
        d = _hfind('drug', m[1]); b = B(); n = d['data']['stock'] + (b.get('delta') or 0)
        if n < 0: return S(400, dict(message='Stock cannot be negative'))
        d['data']['stock'] = n; return S(200, d)
    if method == 'POST' and s == 'admissions':
        b = B(); bed = _hfind('bed', b.get('bed')); pat = _hfind('patient', b.get('patient'))
        if not bed or bed['status'] != 'Available': return S(409, dict(message='The bed is not available'))
        HN['adm'] += 1; code = 'AD-%04d' % HN['adm']; bed['status'] = 'Occupied'; bed['data'].update(admission=code, patientName=pat['data']['name'])
        a = _hrec('admission', code, dict(patientName=pat['data']['name'], bed=bed['code'], reason=b.get('reason', '')), 'Admitted', pat['code']); DB[('hos', 'admission')].append(a); return S(200, a)
    m = re.fullmatch(r'admissions/([\w-]+)/(transfer|discharge)', s)
    if m and method == 'POST':
        a = _hfind('admission', m[1]); b = B(); old = _hfind('bed', a['data']['bed'])
        old['status'] = 'Available'; old['data'].pop('admission', None); old['data'].pop('patientName', None)
        if m[2] == 'discharge': a['status'] = 'Discharged'; a['data'].update(outcome=b.get('outcome'), summary=b.get('summary')); return S(200, a)
        nb = _hfind('bed', b.get('bed'))
        if not nb or nb['status'] != 'Available': old['status'] = 'Occupied'; return S(409, dict(message='The bed is not available'))
        nb['status'] = 'Occupied'; nb['data'].update(admission=a['code'], patientName=a['data']['patientName']); a['data']['bed'] = nb['code']; return S(200, a)
    m = re.fullmatch(r'invoices/([\w-]+)/pay', s)
    if m and method == 'POST':
        i = _hfind('invoice', m[1]); b = B(); amt = float(b.get('amount') or 0); d = i['data']
        if amt <= 0 or amt > d['balance'] + 0.001: return S(400, dict(message='Invalid amount'))
        d['paid'] = _r2(d['paid'] + amt); d['balance'] = _r2(d['total'] - d['paid']); d['payments'].append(dict(amount=amt, method=b.get('method'), by='admin')); i['status'] = 'Paid' if d['balance'] <= 0 else 'Partial'; return S(200, i)
    return False


def _pos_price(items, body):
    prods = {r['code'].lower(): r for r in DB[('pos', 'product')]}
    cfg = DB[('pos', 'setting')][0]['data']
    cust = next((c for c in DB[('pos', 'customer')] if c['code'] == body.get('customer')), None)
    cpct = (cust or {}).get('data', {}).get('discountPct') or 0
    lines = []
    for it in items:
        p = prods.get(it['sku'].lower())
        if not p: continue
        price = p['data']['price']; gross = _r2(price * it['qty']); best = 0
        for pr in DB[('pos', 'promotion')]:
            d = pr['data']
            if d.get('scope') == 'sku' and d.get('target', '').lower() != p['code'].lower(): continue
            v = d.get('value') or 0
            disc = gross * v / 100 if d.get('type') == 'pct' else min(gross, v * it['qty']) if d.get('type') == 'amount' else 0
            best = max(best, disc)
        best = _r2(best); rest = gross - best
        man = _r2(rest * (it.get('discountPct') or 0) / 100); rest -= man
        cu = _r2(rest * cpct / 100); rest -= cu
        od = _r2(rest * (body.get('discountPct') or 0) / 100); rest -= od
        net = _r2(rest); rate = cfg['taxRate']
        if cfg['pricesIncludeTax']: tax = _r2(net - net / (1 + rate / 100))
        else: tax = _r2(net * rate / 100); net = _r2(net + tax)
        lines.append(dict(sku=p['code'], name=p['data']['name'], qty=it['qty'], price=price, gross=gross, discount=_r2(best + man + cu + od), tax=tax, total=net, returned=0))
    return lines, cust


def _orec(mod, kind, code, data, status=None, ref=None): return dict(id=str(uuid.uuid4()), module=mod, kind=kind, code=code, company=None, status=status, ref=ref, createdBy='admin', data=data)
OPS = dict(profile=dict(sellerName='Demo Co', sellerNameAr='', vatNo='300000000000003', crNo='', street='', building='', district='', city='Riyadh', postalCode='11564', country='SA'), inv=0)
def _ops_seed():
    DB[('mfg', 'bom')] = [_orec('mfg', 'bom', 'FG1', dict(name='Chair', qty=1, lines=[dict(sku='RM1', qty=2, scrapPct=5), dict(sku='SF1', qty=1)], workCenter='WC1', routingMinutes=30), 'Active'),
                          _orec('mfg', 'bom', 'SF1', dict(name='Frame', qty=2, lines=[dict(sku='RM2', qty=4)], workCenter='WC1', routingMinutes=20), 'Active')]
    DB[('mfg', 'workcenter')] = [_orec('mfg', 'workcenter', 'WC1', dict(name='Assembly', costPerHour=60))]
    DB[('mfg', 'setting')] = [_orec('mfg', 'setting', 'defaults', dict(overheadPct=10))]
    DB[('mfg', 'workorder')] = [_orec('mfg', 'workorder', 'WO-0001', dict(sku='FG1', qty=3, bomQty=1, routingMinutes=30, lines=[dict(sku='RM1', qty=2, scrapPct=5)]), 'Planned'),
        _orec('mfg', 'workorder', 'WO-0002', dict(sku='FG1', qty=10, goodQty=10, materialCost=240, laborCost=300, overheadCost=30, actualCost=570, standardCost=550, variance=20), 'Completed')]
    DB[('prj', 'project')] = [_orec('prj', 'project', 'P1', dict(name='Website', customer='Alpha', billingModel='tm', lines=[dict(category='Labor', amount=2000)]), 'Active'),
                              _orec('prj', 'project', 'P2', dict(name='Fit-out', customer='Beta', billingModel='milestone', lines=[]), 'Active'),
                              _orec('prj', 'project', 'P3', dict(name='Internal', customer='', billingModel='tm', lines=[]), 'Active')]
    DB[('prj', 'timesheet')] = [_orec('prj', 'timesheet', 'TS-1', dict(hours=10, costRate=30, rate=80, billable=True), 'Approved', 'P1'), _orec('prj', 'timesheet', 'TS-2', dict(hours=4, costRate=30, rate=80, billable=True), 'Draft', 'P1')]
    DB[('prj', 'cost')] = [_orec('prj', 'cost', 'C-1', dict(amount=100, billable=True, markupPct=10, type='Travel'), 'Open', 'P1')]
    DB[('prj', 'milestone')] = [_orec('prj', 'milestone', 'M-1', dict(amount=5000), 'Achieved', 'P2'), _orec('prj', 'milestone', 'M-2', dict(amount=3000), 'Pending', 'P2')]
    DB[('prj', 'task')] = [_orec('prj', 'task', 'T-1', {}, 'Done', 'P1'), _orec('prj', 'task', 'T-2', {}, 'Open', 'P1')]
def ops_route(h, method, p, q):
    if p == '/api/erp/mfg/items': return h.send(200, [dict(sku='RM1', name='Wood', cost=10), dict(sku='RM2', name='Steel', cost=5), dict(sku='SF1', name='Frame', cost=0), dict(sku='FG1', name='Chair', cost=0)])
    if p == '/api/erp/mfg/stock': return h.send(200, [dict(sku='RM1', qty=8), dict(sku='RM2', qty=100)])
    m = re.fullmatch(r'/api/mfg/workorders/([\w-]+)/(release|start|complete|cancel)', p)
    if m and method == 'POST':
        w = next((x for x in DB[('mfg', 'workorder')] if x['id'] == m.group(1)), None)
        if not w: return h.send(404, dict(message='nf'))
        a = m.group(2); ok = dict(release=('Planned',), start=('Released',), complete=('InProgress',), cancel=('Planned', 'Released'))[a]
        if w['status'] not in ok: return h.send(400, dict(message='Not allowed in status ' + w['status']))
        w['status'] = dict(release='Released', start='InProgress', complete='Completed', cancel='Cancelled')[a]
        if a == 'complete': b = h.body(); w['data'].update(goodQty=b.get('qty'), actualCost=100, variance=5)
        return h.send(200, w)
    m = re.fullmatch(r'/api/erp/prj/projects/([\w-]+)/bill', p)
    if m and method == 'POST':
        b = h.body(); pr = next((x for x in DB[('prj', 'project')] if x['id'] == m.group(1)), None)
        if not pr: return h.send(404, dict(message='nf'))
        net, n = 0, 0
        for t in DB[('prj', 'timesheet')]:
            if t['ref'] == pr['code'] and t['status'] == 'Approved' and t['data'].get('billable'): net += t['data']['hours'] * t['data']['rate']; t['status'] = 'Billed'; n += 1
        for c in DB[('prj', 'cost')]:
            if c['ref'] == pr['code'] and c['status'] == 'Open' and c['data'].get('billable'): net += c['data']['amount'] * (1 + c['data'].get('markupPct', 0) / 100); c['status'] = 'Billed'; n += 1
        for mm in DB[('prj', 'milestone')]:
            if mm['ref'] == pr['code'] and mm['status'] == 'Achieved' and pr['data'].get('billingModel') != 'tm': net += mm['data']['amount']; mm['status'] = 'Billed'; n += 1
        if net <= 0: return h.send(400, dict(message='Nothing ready to bill'))
        tax = round(net * (b.get('taxPct') or 0) / 100, 2); OPS['inv'] += 1; pr['data']['billed'] = pr['data'].get('billed', 0) + net
        return h.send(200, dict(invoice='AR-9%03d' % OPS['inv'], net=net, tax=tax, total=round(net + tax, 2), lines=n))
    m = re.fullmatch(r'/api/finance/zatca/(invoice|issue)/([\w-]+)', p)
    if m:
        iid = m.group(2); z = ZAT.setdefault(iid, dict(issued=False))
        if m.group(1) == 'issue' and method == 'POST' and not z['issued']:
            n = len([x for x in ZAT.values() if x['issued']]) + 1
            z.update(issued=True, uuid='11111111-2222-3333-4444-%012d' % n, icv=n, pih='PIH' + str(n - 1), hash='HASH' + str(n), qr='AQVTZWxsZXI=', type='Simplified', issuedAt='2026-11-04T10:00:00Z', issuedBy='admin', signed=False, xml='<Invoice id="%s"/>' % iid)
        return h.send(200, z)
    if p == '/api/finance/zatca/profile':
        if method == 'PUT': OPS['profile'] = h.body()
        return h.send(200, OPS['profile'])
    if p == '/api/finance/zatca/vat-return':
        fr, to = q.get('from', [''])[0], q.get('to', [''])[0]
        return h.send(200, dict(**{'from': fr, 'to': to}, sales=[dict(category='Standard', count=3, net=1000, vat=150), dict(category='Zero', count=1, net=200, vat=0)], purchases=[dict(category='Standard', count=2, net=400, vat=60)],
            salesByCode=[dict(code='S15', count=3, net=1000, vat=150)], purchasesByCode=[dict(code='P15', count=2, net=400, vat=60)], salesNet=1200, purchasesNet=400, outputVat=150, inputVat=60, netVatDue=90,
            salesInvoices=4, purchaseInvoices=2, einvoiced=3, notEinvoiced=1, warnings=dict(missingTaxCode=[])))
    return False

WEB = dict(sites=[], subs=[], n=0)
CUS = dict(mods=[], recs={}, n=0)
def _slug(t): return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-') or 'item'
def _site_row(x): return {k: x[k] for k in ('id', 'name', 'slug', 'published', 'publishedAt', 'updatedAt', 'currency')}

ZAT = {}
ADM = dict(done=False, mods=['hr', 'finance', 'pos'], inv=[
    dict(id='b1', number='INV-2026-10', period='2026-10', issuedAt='2026-10-01T00:00:00Z', dueAt='2026-10-15T00:00:00Z', status='open', overdue=True, currency='USD', users=2, unitPrice=8, total=16, sarPerUsd=3.75, totalSar=60, companyName='Main Company', taxNo='300000000000003', lines=[dict(branch='HQ', branchName='Head Office', users=2, amount=16)]),
    dict(id='b2', number='INV-2026-09', period='2026-09', issuedAt='2026-09-01T00:00:00Z', dueAt='2026-09-15T00:00:00Z', status='paid', overdue=False, currency='USD', users=1, unitPrice=8, total=8, sarPerUsd=3.75, totalSar=30, companyName='Main Company', method='card', paidAt='2026-09-03T00:00:00Z', lines=[dict(branch='HQ', branchName='Head Office', users=1, amount=8)])])
ALLMODS = ['hr', 'finance', 'pos', 'mfg', 'prj', 'crm', 'proc', 'scm', 'wh', 'ast', 'pay', 'epm', 'bpm', 'int', 'bi', 'website', 'workflow', 'hospital', 'calendar', 'muslim', 'custom']
def adm_route(h, method, p):
    if p == '/api/org' and method == 'GET':
        return h.send(200, dict(tenant=dict(id='acme', name='Acme Workspace', plan='business', maxUsers=20, maxCompanies=1, maxBranches=0, users=len(USERS), companies=len(COMPANIES), branches=len(BRANCHES), setupDone=ADM['done']), companies=COMPANIES, branches=BRANCHES))
    if p == '/api/org/setup/complete' and method == 'POST': ADM['done'] = True; return h.send(200, {})
    if p == '/api/org/modules':
        if method == 'PUT': ADM['mods'] = [m for m in h.body().get('enabled', []) if m in ALLMODS]
        return h.send(200, dict(all=ALLMODS, enabled=ADM['mods'], restricted=True))
    if p == '/api/users/permissions' and method == 'GET': return h.send(200, dict(groups=[], roleDefaults={}, roles=['admin', 'employee', 'manager']))
    if p == '/api/users/admin' and method == 'POST':
        b = h.body()
        if b.get('invite'):
            u = dict(id='u%d' % (len(USERS) + 1), username=b['username'], displayName=b.get('displayName'), email=b.get('email'), role=b.get('role'), isActive=True, permissions=None, branches=b.get('branches'), invitePending=True, inviteToken='tok-' + b['username'], createdAt='2026-11-04T08:00:00Z')
            USERS.append(u); return h.send(200, u)
        return False
    m = re.fullmatch(r'/api/users/admin/([\w-]+)/invite', p)
    if m and method == 'POST':
        u = next((x for x in USERS if x['id'] == m[1]), None)
        if not u: return h.send(404, dict(message='nf'))
        u['invitePending'] = True; u['inviteToken'] = 'tok-' + u['username']; return h.send(200, u)
    if p == '/api/billing/summary': return h.send(200, dict(users=len(USERS), unitPrice=8, estimate=8 * len(USERS), currency='USD', lines=[dict(branch='HQ', branchName='Head Office', users=len(USERS), amount=8 * len(USERS))], pricePerUser=8, volumePrice=6, volumeFrom=50, sarPerUsd=3.75, balance=sum(i['total'] for i in ADM['inv'] if i['status'] == 'open'), openInvoices=sum(1 for i in ADM['inv'] if i['status'] == 'open'), provider='sandbox', nextInvoice='2026-12-01T00:00:00Z'))
    if p == '/api/billing/invoices' and method == 'GET': return h.send(200, ADM['inv'])
    m = re.fullmatch(r'/api/billing/invoices/([\w-]+)/(pay|confirm|sandbox-pay)', p)
    if m and method == 'POST':
        i = next((x for x in ADM['inv'] if x['id'] == m[1]), None)
        if not i: return h.send(404, dict(message='nf'))
        if m[2] == 'pay': return h.send(200, dict(url='', provider='sandbox'))
        if m[2] == 'sandbox-pay': i['status'] = 'paid'; i['overdue'] = False; i['method'] = 'sandbox'
        return h.send(200, i)
    return False

def web_route(h, method, p, q):
    now = '2026-11-04T09:00:00Z'
    if p == '/api/website/sites':
        if method == 'GET': return h.send(200, [_site_row(x) for x in WEB['sites']])
        b = h.body(); WEB['n'] += 1
        x = dict(id='s%d' % WEB['n'], name=b['name'], slug=_slug(b['name']), published=False, publishedAt=None, updatedAt=now, currency=b.get('currency', 'SAR'), design=b['design'], html=None)
        WEB['sites'].append(x); return h.send(200, _site_row(x))
    m = re.fullmatch(r'/api/website/sites/([\w-]+)(?:/(publish|unpublish))?', p)
    if m:
        x = next((s for s in WEB['sites'] if s['id'] == m.group(1)), None)
        if not x: return h.send(404, dict(message='nf'))
        if m.group(2) == 'publish':
            b = h.body()
            if not b.get('html'): return h.send(400, 'The page is empty or too large.')
            x.update(published=True, publishedAt=now, html=b['html'], currency=b.get('currency') or x['currency']); return h.send(200, _site_row(x))
        if m.group(2) == 'unpublish': x['published'] = False; return h.send(200, _site_row(x))
        if method == 'GET': return h.send(200, dict(_site_row(x), design=x['design']))
        if method == 'PUT': b = h.body(); x['name'] = b['name']; x['design'] = b['design']; x['updatedAt'] = now; return h.send(200, _site_row(x))
        if method == 'DELETE': WEB['sites'].remove(x); return h.send(204)
    if p == '/api/website/submissions': return h.send(200, WEB['subs'])
    m = re.fullmatch(r'/api/website/submissions/([\w-]+)', p)
    if m and method == 'PUT':
        for s in WEB['subs']:
            if s['id'] == m.group(1): s['status'] = h.body()['status']; return h.send(200, s)
    return False
def cus_route(h, method, p, q):
    if p == '/api/custom/modules':
        if method == 'GET': return h.send(200, CUS['mods'])
        d = h.body()
        if not d.get('title'): return h.send(400, 'A name is required.')
        for f in d.get('fields', []): f['key'] = _slug(f.get('label', 'f')).replace('-', '_')
        m = dict(key=_slug(d['title']), def_=None); m = dict(key=m['key'], **{'def': d}); CUS['mods'].append(m); CUS['recs'][m['key']] = []; return h.send(200, m)
    m = re.fullmatch(r'/api/custom/modules/([\w-]+)', p)
    if m:
        x = next((s for s in CUS['mods'] if s['key'] == m.group(1)), None)
        if not x: return h.send(404, dict(message='nf'))
        if method == 'PUT':
            d = h.body()
            for f in d.get('fields', []): f['key'] = f.get('key') or _slug(f.get('label', 'f')).replace('-', '_')
            x['def'] = d; return h.send(200, x)
        if method == 'DELETE': CUS['mods'].remove(x); return h.send(204)
    m = re.fullmatch(r'/api/custom/records/([\w-]+)(?:/([\w-]+))?', p)
    if m:
        lst = CUS['recs'].setdefault(m.group(1), [])
        if method == 'GET':
            qq = (q.get('q', [''])[0] or '').lower()
            return h.send(200, [r for r in lst if not qq or qq in json.dumps(r['data']).lower()])
        if method == 'POST': CUS['n'] += 1; r = dict(id='r%d' % CUS['n'], kind=m.group(1), code='%s-%04d' % (m.group(1)[:3].upper(), len(lst) + 1), status=None, data=h.body()['data'], createdAt='2026-11-04T09:00:00Z'); lst.append(r); return h.send(200, r)
        for r in lst:
            if r['id'] == m.group(2):
                if method == 'PUT': r['data'] = h.body()['data']; return h.send(200, r)
                if method == 'DELETE': lst.remove(r); return h.send(204)
    return False
def _web_seed():
    WEB['subs'] = [dict(id='o1', siteId='s1', kind='order', number='ORD-0001', name='Ali', email='a@x.com', phone='', address='Riyadh', note='', lines=[dict(sku='A1', name='Tea Pot', qty=2, price=12.5)], total=25, currency='SAR', status='new', createdAt='2026-11-03T10:00:00Z'),
                   dict(id='m1', siteId='s1', kind='message', number='MSG-0001', name='Huda', email='h@x.com', phone='', address='', note='Do you ship abroad?', lines=[], total=0, currency='SAR', status='new', createdAt='2026-11-03T11:00:00Z')]

EMP = [dict(id='e1', empNo='E001', status='Active', fullName='Sara Ahmed', department='Finance', basicSalary=9000)]
_hr_seed()
_ops_seed()
_web_seed()
USERS = [dict(id='u1', username='admin', displayName='Admin User', email='admin@demo.co', role='admin', isActive=True, permissions=None, branches=None)]
ROLES = [dict(role='admin', name='Administrator', permissions=[], isSystem=True, users=1), dict(role='employee', name='Employee', permissions=['tasks.act'], isSystem=True, users=0)]
COMPANIES = [dict(code='C1', name='Demo Co', nameAr='شركة', currency='SAR', taxNo='300', country='SA')]
BRANCHES = [dict(code='B1', company='C1', name='Main', nameAr='الرئيسي', warehouse='W1', city='Riyadh')]
seed()
FORM = dict(id='f9', title='Manager review', fields=[
  dict(id='a', key='days', label='Days', type='Number', required=True, options=[], readOnly=True),
  dict(id='b', key='reason', label='Reason', type='TextArea', required=False, options=[], readOnly=False, placeholder='Why?'),
  dict(id='c', key='kind', label='Leave type', type='Select', required=True, options=[dict(label='Annual', value='annual'), dict(label='Sick', value='sick')], readOnly=False),
  dict(id='d', key='from', label='From', type='Date', required=False, options=[], readOnly=False),
  dict(id='e', key='paid', label='Paid leave', type='Checkbox', required=False, options=[], readOnly=False, placeholder='Yes, paid')])
TASKS = [dict(id='t1', instanceId='i1', nodeName='Manager review', priority='High', availableDecisions=['Approve', 'Reject'], createdAt='2026-10-01T08:00:00Z', form=FORM)]
NOTES, FILES, CFG = {}, {}, {}
INST = [dict(id='i1', definitionId='d1', definitionName='Leave request', status='Running', currentNodeIds=['n4'], startedBy='admin', startedAt='2026-10-12T09:00:00Z', data={'days': 7}, history=[dict(timestamp='2026-10-12T09:00:00Z', nodeId='n1', nodeName='Start', action='Started', actor='admin'), dict(timestamp='2026-10-12T09:01:00Z', nodeId='n2', nodeName='Fill request', action='Approved', actor='admin')])]

def _gen_erp():
    """Sample ERP documents (PR / SO / TRF / PV / EXP) spread over six months for the dashboard and reports."""
    import datetime as dt, random
    rnd = random.Random(7); now = dt.datetime.utcnow().replace(microsecond=0)
    names = dict(PR='ERP · Purchase Requisition (Procure-to-Pay)', SO='ERP · Sales Order (Order-to-Cash)', TRF='ERP · Stock Transfer', PV='ERP · Payment Voucher', EXP='ERP · Expense Claim')
    flow = dict(PR=['Manager Approval', 'Issue Purchase Order', 'Goods Receipt', 'Vendor Invoice & Payment'], SO=['Sales Manager Approval', 'Deliver Goods', 'Invoice & Collect Payment'],
                TRF=['Warehouse Approval', 'Dispatch & Receive'], PV=['Finance Approval', 'Finance Payment'], EXP=['Manager Approval', 'Finance Review & Payment'])
    parties = dict(PR=['Gulf Steel', 'Nile Paper', 'Delta Tools'], SO=['Alpha Trading', 'Blue Star', 'Cairo Mart', 'Dune Co'], TRF=['Main Store'], PV=['Utilities Co', 'Landlord'], EXP=['Sara Ahmed', 'Omar Ali'])
    out = []
    for n in range(36):
        k = ['PR', 'SO', 'SO', 'PR', 'TRF', 'PV', 'EXP'][n % 7]
        start = now - dt.timedelta(days=rnd.randint(0, 170) if n > 11 else rnd.randint(1, 6), hours=rnd.randint(0, 20))
        steps = flow[k]; hist = [dict(timestamp=start.isoformat() + 'Z', nodeId='s', nodeName='Start', action='Entered', actor='admin')]
        state = rnd.choice(['done', 'done', 'done', 'open', 'open', 'rej']); at = start; cur = None
        reach = len(steps) if state == 'done' else rnd.randint(0, len(steps) - 1)
        for j, st in enumerate(steps[:reach + 1]):
            at += dt.timedelta(hours=rnd.randint(2, 60))
            hist.append(dict(timestamp=at.isoformat() + 'Z', nodeId='n%d' % j, nodeName=st, action='Entered', actor='system'))
            if j < reach or state == 'done':
                at += dt.timedelta(hours=rnd.randint(1, 48))
                hist.append(dict(timestamp=at.isoformat() + 'Z', nodeId='n%d' % j, nodeName=st, action='Approved', actor='admin', comment=''))
                if st == 'Post to General Ledger' or (state == 'done' and j == len(steps) - 1):
                    hist.append(dict(timestamp=at.isoformat() + 'Z', nodeId='gl', nodeName='Post to General Ledger', action='Logged', actor='system', comment='Dr Expense / Cr Bank'))
            if state == 'rej' and j == reach:
                at += dt.timedelta(hours=3); hist.append(dict(timestamp=at.isoformat() + 'Z', nodeId='n%d' % j, nodeName=st, action='Rejected', actor='admin'))
        total = rnd.randint(8, 120) * 100; party = rnd.choice(parties[k]); item = rnd.choice(['Steel bar', 'A4 paper', 'Drill'])
        data = dict(docType=k, docNumber='%s-2610-%04d' % (k, n + 1), party=party, total=total, currency='SAR', company='C1', branch=rnd.choice(['Riyadh', 'Jeddah']), lines=[dict(item=item, qty=rnd.randint(1, 30))])
        done = state in ('done', 'rej')
        out.append(dict(id='e%02d' % n, definitionId='x', definitionName=names[k], status='Completed' if done else 'Running', currentNodeIds=[], startedBy=rnd.choice(['admin', 'sara']),
                        startedAt=start.isoformat() + 'Z', completedAt=at.isoformat() + 'Z' if done else None, data=data, history=hist))
    return out
def _n(i, t, name, x, y, **kw): return dict(id=i, type=t, name=name, x=x, y=y, **kw)
INST += _gen_erp()
DEFS = [dict(id='d1', name='Leave request', description='Employee leave approval', isPublished=True, version=1, tenantId='t1', createdAt='2026-10-01T08:00:00Z', updatedAt='2026-10-01T08:00:00Z',
  nodes=[_n('n1', 'Start', 'Start', 40, 120), _n('n2', 'FormTask', 'Fill request', 180, 110, assignee='employee', priority='Normal', escalationMode='Reassign', form=dict(id='f1', title='Leave', fields=[dict(id='ff1', key='days', label='Days', type='Number', required=True, options=[], readOnly=False)])),
         _n('n3', 'Condition', 'More than 5 days?', 360, 100, conditionExpression='days > 5'), _n('n4', 'ApprovalTask', 'Manager approval', 560, 40, assignee='admin', priority='High', escalationMode='Reassign'),
         _n('n5', 'End', 'Approved', 760, 120), _n('n6', 'End', 'Rejected', 760, 240)],
  edges=[dict(id='e1', sourceNodeId='n1', targetNodeId='n2', label='Default'), dict(id='e2', sourceNodeId='n2', targetNodeId='n3', label='Default'), dict(id='e3', sourceNodeId='n3', targetNodeId='n4', label='True'),
         dict(id='e4', sourceNodeId='n3', targetNodeId='n5', label='False'), dict(id='e5', sourceNodeId='n4', targetNodeId='n5', label='Approve'), dict(id='e6', sourceNodeId='n4', targetNodeId='n6', label='Reject')])]

def eval_cond(expr, data):
    ops = [('>=', lambda a, b: a >= b), ('<=', lambda a, b: a <= b), ('==', lambda a, b: a == b), ('!=', lambda a, b: a != b), ('>', lambda a, b: a > b), ('<', lambda a, b: a < b)]
    sep = '||' if '||' in expr else '&&'; out = []
    for part in [x.strip() for x in expr.split(sep) if x.strip()]:
        for o, f in ops:
            if o in part:
                k, v = [x.strip() for x in part.split(o, 1)]; a = data.get(k)
                try: a, v2 = float(a), float(v)
                except (TypeError, ValueError): a, v2 = str(a), v.strip('"\'')
                out.append(dict(clause=part, result=bool(f(a, v2)))); break
    res = (any if sep == '||' else all)(c['result'] for c in out) if out else False
    return dict(result=res, clauses=out)
def chat(msg, lang):
    ar = lang == 'ar'
    T = lambda en, a: a if ar else en
    q = msg.lower()
    sug = [T('What is waiting for me?', 'ما الذي ينتظرني؟'), T('Show purchase orders', 'اعرض أوامر الشراء'), T('How many leads?', 'كم عدد العملاء المحتملين؟')]
    m = re.search(r'\b([a-z]{1,6}-[a-z0-9]{3,})\b', q)
    if m:
        for (mod, kind), rows in DB.items():
            for r in rows:
                if (r.get('code') or '').lower() == m[1]:
                    return dict(reply='%s · %s — %s' % (kind, r['code'], r.get('status')), actions=[dict(label=r['code'], module=mod, kind=kind, id=r['id'])], suggestions=sug)
    if any(w in q for w in ('waiting', 'pending', 'approval')) or any(w in msg for w in ('ينتظر', 'موافق')):
        ap = [r for r in DB.get(('gov', 'approval'), []) if r['status'] == 'Pending']
        txt = T('%d task(s) and %d approval(s) are waiting for you.' % (len(TASKS), len(ap)), 'لديك %d مهمة و%d موافقة بانتظارك.' % (len(TASKS), len(ap)))
        return dict(reply=txt, actions=[dict(label=T('Approvals', 'الموافقات'), module='gov', kind='approval')], suggestions=sug)
    for mdl in cat['modules']:
        for k in mdl['kinds']:
            names = [k['en'].lower(), k['en'].lower().rstrip('s'), k['ar']]
            if any(n and (n in q or n in msg) for n in names):
                rows = DB.get((mdl['id'], k['kind']), [])
                txt = T('%s: %d record(s).' % (k['en'], len(rows)), '%s: %d سجل.' % (k['ar'], len(rows)))
                for r in rows[:5]: txt += '\n• %s (%s)' % (r.get('code'), r.get('status'))
                return dict(reply=txt, actions=[dict(label=k['ar'] if ar else k['en'], module=mdl['id'], kind=k['kind'])], suggestions=sug)
    return dict(reply=T('I did not understand that. Try: "What is waiting for me?", "Show purchase orders", "Find PO-0001".', 'لم أفهم ذلك. جرّب: «ما الذي ينتظرني؟» أو «اعرض أوامر الشراء» أو «ابحث عن PO-0001».'), actions=[], suggestions=sug)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj=None):
        b = b'' if obj is None else json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}') if n else {}
    def route(self, method):
        p = self.path.split('?')[0]
        if method == 'POST' and p == '/api/auth/login':
            b = self.body()
            if b.get('username') == 'admin' and b.get('password') == 'admin':
                return self.send(200, dict(token='tok', id='u1', username='admin', displayName='Admin User', role='admin', permissions=perms, tenantName='Demo Co'))
            return self.send(401, dict(message='bad'))
        if self.headers.get('Authorization') != 'Bearer tok': return self.send(401, dict(message='auth'))
        if p == '/api/users/me': return self.send(200, dict(effectivePermissions=perms, displayName='Admin User', role='admin'))
        if p == '/api/assistant/chat' and method == 'POST':
            b = self.body(); return self.send(200, chat(b.get('message', ''), b.get('lang', 'en')))
        if p == '/api/tasks': return self.send(200, TASKS)
        mc = re.fullmatch(r'/api/collab/(\w+)/(\w+)/([\w-]+)/(notes|files)', p)
        if mc:
            key = mc.group(1, 2, 3); store = NOTES if mc[4] == 'notes' else FILES
            if method == 'GET': return self.send(200, store.get(key, []))
            b = self.body(); n = dict(id=str(uuid.uuid4()), author='admin', createdAt='2026-11-03T08:00:00Z')
            if mc[4] == 'notes': n.update(text=b.get('text', ''), system=False)
            else: n.update(name=b.get('name'), type=b.get('type'), size=len(b.get('content', '')) * 3 // 4, content=b.get('content', ''))
            store.setdefault(key, []).append(n); return self.send(200, {k: v for k, v in n.items() if k != 'content'})
        mc = re.fullmatch(r'/api/collab/(notes|files)/([\w-]+)', p)
        if mc:
            store = NOTES if mc[1] == 'notes' else FILES
            if method == 'DELETE':
                for k in store: store[k] = [x for x in store[k] if x['id'] != mc[2]]
                return self.send(204)
            for l in store.values():
                for x in l:
                    if x['id'] == mc[2]:
                        import base64; b = base64.b64decode(x.get('content', '')); self.send_response(200); self.send_header('Content-Type', 'application/octet-stream'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        mc = re.fullmatch(r'/api/collab/configs/(\w+)(?:/([\w-]+))?', p)
        if mc:
            view = (self.path.split('view=') + [''])[1].split('&')[0]
            if method == 'GET': return self.send(200, [dict(c, mine=True) for c in CFG.get((mc[1], view), [])])
            if method == 'POST':
                b = self.body(); c = dict(id=str(uuid.uuid4()), name=b.get('name'), shared=b.get('shared', False), author='admin', data=b.get('data')); CFG.setdefault((mc[1], view), []).append(c); return self.send(200, dict(c, mine=True))
            if method == 'DELETE':
                for k in CFG: CFG[k] = [c for c in CFG[k] if c['id'] != mc[2]]
                return self.send(204)
        m = re.fullmatch(r'/api/tasks/(\w+)/complete', p)
        if m and method == 'POST':
            TASKS[:] = [t for t in TASKS if t['id'] != m[1]]; return self.send(200, {})
        if p == '/api/instances' and method == 'GET': return self.send(200, INST)
        if p == '/api/users' and method == 'GET': return self.send(200, [dict(id=u['id'], username=u['username'], displayName=u['displayName'], role=u['role']) for u in USERS] + [dict(id='u9', username='sara', displayName='Sara Ahmed', role='employee')])
        if p == '/api/definitions/test-condition' and method == 'POST':
            b = self.body(); return self.send(200, eval_cond(b.get('expression', ''), b.get('data') or {}))
        if p == '/api/definitions' and method == 'GET': return self.send(200, DEFS)
        if p == '/api/definitions' and method == 'POST':
            b = self.body(); d = dict(id='d%d' % (len(DEFS) + 1), name=b.get('name'), description=b.get('description', ''), isPublished=False, version=1, tenantId='t1', createdAt='2026-10-14T00:00:00Z', updatedAt='2026-10-14T00:00:00Z', nodes=b.get('nodes', []), edges=b.get('edges', [])); DEFS.append(d); return self.send(200, d)
        m = re.fullmatch(r'/api/definitions/(\w+)(/publish)?', p)
        if m:
            d = next((x for x in DEFS if x['id'] == m[1]), None)
            if not d: return self.send(404, dict(message='nf'))
            if method == 'DELETE': DEFS.remove(d); return self.send(204, None)
            if method == 'PUT':
                b = self.body(); d.update(name=b.get('name'), description=b.get('description', ''), nodes=b.get('nodes', []), edges=b.get('edges', [])); d['isPublished'] = False; return self.send(200, d)
            if m[2]:
                if sum(1 for n in d['nodes'] if n['type'] == 'Start') != 1: return self.send(400, 'Workflow must have exactly one Start node.')
                if not any(n['type'] == 'End' for n in d['nodes']): return self.send(400, 'Workflow must have at least one End node.')
                d['isPublished'] = True; return self.send(200, d)
            return self.send(200, d)
        if p == '/api/instances/start':
            b = self.body(); d = next((x for x in DEFS if x['id'] == b['definitionId']), None)
            if not d or not d['isPublished']: return self.send(400, 'Workflow is not published.')
            st = next(n for n in d['nodes'] if n['type'] == 'Start'); nxt = [e['targetNodeId'] for e in d['edges'] if e['sourceNodeId'] == st['id']]
            INST.append(dict(id='i%d' % (len(INST) + 1), definitionId=d['id'], definitionName=d['name'], status='Running', currentNodeIds=nxt, startedBy='admin', startedAt='2026-10-14T09:00:00Z', data=b.get('initialData') or {}, history=[dict(timestamp='2026-10-14T09:00:00Z', nodeId=st['id'], nodeName=st['name'], action='Started', actor='admin')]))
            fn = next((n for n in d['nodes'] if n['id'] in nxt and n.get('form')), None)
            if fn: TASKS.append(dict(id='t%d' % (len(TASKS) + 50), instanceId=INST[-1]['id'], nodeName=fn['name'], priority='Normal', availableDecisions=['Submit'], createdAt='2026-11-03T08:00:00Z', form=fn['form']))
            return self.send(200, INST[-1])
        m = re.fullmatch(r'/api/instances/(\w+)/activity-log', p)
        if m: return self.send(200, [dict(id=k, instanceId=m[1], definitionId='d1', nodeId=h['nodeId'], nodeName=h['nodeName'], action=h['action'], actor=h.get('actor'), timestamp=h['timestamp']) for k, h in enumerate(next((x for x in INST if x['id'] == m[1]), dict(history=[]))['history'])])
        m = re.fullmatch(r'/api/instances/(\w+)(/cancel)?', p)
        if m:
            i = next((x for x in INST if x['id'] == m[1]), None)
            if not i: return self.send(404, dict(message='nf'))
            if m[2]: i['status'] = 'Terminated'
            return self.send(200, i)
        m = re.fullmatch(r'/api/erp/gov/approvals/([\w-]+)/(approve|reject)', p)
        if m and method == 'POST':
            for r in DB[('gov', 'approval')]:
                if r['id'] == m[1]: r['status'] = 'Approved' if m[2] == 'approve' else 'Rejected'
            return self.send(200, {})
        def crud(path, lst, key, make):
            if p == path and method == 'GET': return self.send(200, lst)
            if p == path and method == 'POST':
                b = self.body(); x = make(b); lst.append(x); return self.send(200, x)
            mm = re.fullmatch(re.escape(path) + r'/([\w.-]+)', p)
            if mm:
                x = next((e for e in lst if e[key] == mm[1]), None)
                if not x: return self.send(404, dict(message='nf'))
                if method == 'DELETE': lst.remove(x); return self.send(204)
                if method == 'PUT': x.update(self.body()); return self.send(200, x)
            return None
        if p == '/api/admin/rbac' and method == 'GET': return self.send(200, dict(permissions=[], roles=ROLES))
        if p == '/api/admin/rbac/roles' and method == 'POST':
            b = self.body(); r = dict(role=b['role'], name=b.get('name'), permissions=b.get('permissions') or next((x['permissions'] for x in ROLES if x['role'] == b.get('copyFrom')), []), isSystem=False, users=0); ROLES.append(r); return self.send(200, dict(permissions=[], roles=ROLES))
        m = re.fullmatch(r'/api/admin/rbac/roles/([\w-]+)', p)
        if m:
            r = next((x for x in ROLES if x['role'] == m[1]), None)
            if method == 'DELETE' and r: ROLES.remove(r); return self.send(200, dict(permissions=[], roles=ROLES))
            if method == 'PUT' and r: r.update(self.body()); return self.send(200, dict(permissions=[], roles=ROLES))
        m = re.fullmatch(r'/api/users/admin/([\w-]+)/reset-password', p)
        if m and method == 'POST': return self.send(200, {})
        if (p.startswith('/api/org') or p.startswith('/api/billing') or p == '/api/users/permissions' or re.fullmatch(r'/api/users/admin(/[\w-]+/invite)?', p)) and adm_route(self, method, p) is not False: return
        if p == '/api/org' and method == 'GET': return self.send(200, dict(tenant={}, companies=COMPANIES, branches=BRANCHES))
        for path, lst, key, make in (('/api/users/admin', USERS, 'id', lambda b: dict(id='u%d' % (len(USERS) + 1), username=b['username'], displayName=b.get('displayName'), email=b.get('email'), role=b.get('role'), isActive=b.get('isActive', True), permissions=b.get('permissions'), branches=b.get('branches'))),
                                     ('/api/org/companies', COMPANIES, 'code', lambda b: dict(b)), ('/api/org/branches', BRANCHES, 'code', lambda b: dict(b))):
            if crud(path, lst, key, make) is not None: return
        if p in ('/api/hr/summary', '/api/hr/employees/import') and hr_route(self, method, p) is not False: return
        if p == '/api/hr/employees' and method == 'GET': return self.send(200, EMP)
        if p == '/api/hr/employees' and method == 'POST':
            b = self.body(); b['id'] = 'e%d' % (len(EMP) + 1); EMP.append(b); return self.send(200, b)
        m = re.fullmatch(r'/api/hr/employees/([\w-]+)', p)
        if m:
            if method == 'DELETE': EMP[:] = [e for e in EMP if e['id'] != m[1]]; return self.send(204)
            if method == 'PUT':
                b = self.body()
                for e in EMP:
                    if e['id'] == m[1]: e.update(b); return self.send(200, e)
            return self.send(404, dict(message='nf'))
        if p.startswith('/api/pos/') and not p.startswith('/api/pos/records'):
            now = '2026-11-03T10:00:00Z'
            shifts = DB[('pos', 'shift')]; sales = DB[('pos', 'sale')]
            cur = next((x for x in shifts if x['status'] == 'Open'), None)
            if p == '/api/pos/shifts/current': return self.send(200, cur)
            if p == '/api/pos/shifts/open' and method == 'POST':
                b = self.body()
                if cur: return self.send(400, dict(message='A shift is already open'))
                POSN['shift'] += 1
                x = dict(id=str(uuid.uuid4()), module='pos', kind='shift', code='SH-%04d' % POSN['shift'], company='C1', branch=b.get('branch') or 'B1', status='Open', ref=b.get('register'), parent=None, createdBy='admin', createdAt=now,
                         data=dict(opening=b.get('openingCash', 0), openedAt=now, cashSales=0, cardSales=0, otherSales=0, returnsTotal=0, cashIn=0, cashOut=0, salesCount=0, salesTotal=0))
                shifts.append(x); return self.send(200, x)
            m = re.fullmatch(r'/api/pos/shifts/([\w-]+)/(cash|close)', p)
            if m and method == 'POST':
                x = next((s for s in shifts if s['id'] == m[1]), None)
                if not x: return self.send(404, dict(message='nf'))
                b = self.body(); d = x['data']
                if m[2] == 'cash':
                    d['cashIn' if b['type'] == 'in' else 'cashOut'] += b['amount']; return self.send(200, x)
                d['expected'] = _r2(d['opening'] + d['cashSales'] + d['cashIn'] - d['cashOut'] - d['returnsTotal'])
                d['counted'] = b['countedCash']; d['variance'] = _r2(b['countedCash'] - d['expected']); d['journal'] = 'JV-%04d' % (POSN['shift'] + 100); x['status'] = 'Closed'
                return self.send(200, x)
            if p == '/api/pos/sales/checkout' and method == 'POST':
                b = self.body()
                if b.get('localId') and any(s['data'].get('localId') == b['localId'] for s in sales): return self.send(200, next(s for s in sales if s['data'].get('localId') == b['localId']))
                if not cur: return self.send(400, dict(message='Open a shift first'))
                lines, cust = _pos_price(b['lines'], b)
                if not lines: return self.send(400, dict(message='Empty basket'))
                total = _r2(sum(l['total'] for l in lines)); red = 0
                if cust and b.get('redeemPoints'): red = min(b['redeemPoints'], cust['data'].get('points') or 0) * 0.05
                due = _r2(max(0, total - min(red, total))); paid = _r2(sum(x['amount'] for x in b['payments']))
                if paid + 0.004 < due: return self.send(400, dict(message='Payment is short by %.2f' % (due - paid)))
                for l in lines:
                    for st in DB[('pos', 'stock')]:
                        if st['code'] == l['sku'] and DB[('pos', 'product')] and next(pp for pp in DB[('pos', 'product')] if pp['code'] == l['sku'])['data'].get('trackStock'):
                            if st['data']['qty'] < l['qty']: return self.send(400, dict(message='Not enough stock: ' + l['name']))
                            st['data']['qty'] -= l['qty']
                POSN['sale'] += 1; cash = sum(x['amount'] for x in b['payments'] if x['method'] == 'cash'); change = _r2(max(0, paid - due))
                earned = int(due) if cust else 0
                if cust: cust['data']['points'] = (cust['data'].get('points') or 0) - (b.get('redeemPoints') or 0) + earned
                sale = dict(id=str(uuid.uuid4()), module='pos', kind='sale', code='S-%05d' % POSN['sale'], company='C1', branch=b.get('branch') or 'B1', status='Completed', ref=cur['id'], parent=None, createdBy='admin', createdAt=now,
                            data=dict(type='Sale', lines=lines, subtotal=_r2(sum(l['gross'] for l in lines)), discount=_r2(sum(l['discount'] for l in lines)), tax=_r2(sum(l['tax'] for l in lines)), total=total, payments=b['payments'], change=change,
                                      cashier='admin', customer=b.get('customer'), customerName=cust['data']['name'] if cust else None, earned=earned, localId=b.get('localId')))
                sales.append(sale); d = cur['data']; d['salesCount'] += 1; d['salesTotal'] = _r2(d['salesTotal'] + total)
                d['cashSales'] = _r2(d['cashSales'] + cash - change); d['cardSales'] = _r2(d['cardSales'] + sum(x['amount'] for x in b['payments'] if x['method'] == 'card')); d['otherSales'] = _r2(d['otherSales'] + sum(x['amount'] for x in b['payments'] if x['method'] == 'other'))
                return self.send(200, sale)
            m = re.fullmatch(r'/api/pos/sales/([\w-]+)/(return|void)', p)
            if m and method == 'POST':
                sale = next((s for s in sales if s['id'] == m[1]), None)
                if not sale: return self.send(404, dict(message='nf'))
                b = self.body()
                if m[2] == 'void':
                    if not cur or sale['ref'] != cur['id']: return self.send(400, dict(message='Only a sale of the open shift can be voided'))
                    sale['status'] = 'Voided'; return self.send(200, sale)
                got = []
                for rl in b['lines']:
                    l = next(x for x in sale['data']['lines'] if x['sku'] == rl['sku'])
                    if rl['qty'] > l['qty'] - l.get('returned', 0): return self.send(400, dict(message='Cannot return more than was sold'))
                    l['returned'] = l.get('returned', 0) + rl['qty']; unit = l['total'] / l['qty']
                    got.append(dict(l, qty=rl['qty'], total=-_r2(unit * rl['qty']), returned=0))
                POSN['ret'] += 1; tot = _r2(sum(g['total'] for g in got))
                if all(x['returned'] >= x['qty'] for x in sale['data']['lines']): sale['status'] = 'Returned'
                rr = dict(id=str(uuid.uuid4()), module='pos', kind='sale', code='R-%05d' % POSN['ret'], company='C1', branch=sale['branch'], status='Completed', ref=cur['id'] if cur else None, parent=sale['code'], createdBy='admin', createdAt=now,
                          data=dict(type='Return', lines=got, subtotal=tot, discount=0, tax=0, total=tot, payments=[dict(method=b.get('method', 'cash'), amount=-tot)], cashier='admin', reason=b.get('reason')))
                sales.append(rr)
                if cur: cur['data']['returnsTotal'] = _r2(cur['data']['returnsTotal'] - tot)
                return self.send(200, rr)
            if p == '/api/pos/summary': return self.send(200, dict(salesToday=sum(s['data']['total'] for s in sales if s['data']['type'] == 'Sale' and s['status'] != 'Voided'), countToday=len(sales)))
        if (p.startswith('/api/erp/mfg/') or p.startswith('/api/mfg/workorders/') or p.startswith('/api/erp/prj/projects/') or p.startswith('/api/finance/zatca/')) and ops_route(self, method, p, parse_qs(urlparse(self.path).query)) is not False: return
        if p.startswith('/api/website/') and web_route(self, method, p, parse_qs(urlparse(self.path).query)) is not False: return
        if p.startswith('/api/custom/') and cus_route(self, method, p, parse_qs(urlparse(self.path).query)) is not False: return
        if p.startswith('/api/calendar/') and cal_route(self, method, p, parse_qs(urlparse(self.path).query)) is not False: return
        if p.startswith('/api/finance/') and not p.startswith('/api/finance/records') and fin_route(self, method, p) is not False: return
        if p.startswith('/api/hospital/') and hos_route(self, method, p, parse_qs(urlparse(self.path).query)) is not False: return
        m = re.fullmatch(r'/api/(?:erp/(\w+)|(finance)|(hr)|(pos)|(hospital))/records/(\w+)(?:/([\w-]+))?', p)
        if m:
            g = m.groups(); mod = g[0] or {'finance': 'fin', 'hr': 'hr', 'pos': 'pos', 'hospital': 'hos'}[next(x for x in g[1:5] if x)]; kind, rid = g[5], g[6]; lst = DB.setdefault((mod, kind), [])
            if method == 'GET': return self.send(200, lst)
            if method == 'POST':
                b = self.body(); r = dict(id=str(uuid.uuid4()), module=mod, kind=kind, createdBy='admin', **{k: b.get(k) for k in ('code', 'company', 'status', 'ref')}, data=b.get('data', {}))
                if not r['code']: r['code'] = '%s-%04d' % (kind[:2].upper(), len(lst) + 1)
                lst.append(r); return self.send(200, r)
            if method == 'PUT':
                b = self.body()
                for r in lst:
                    if r['id'] == rid: r.update({k: b.get(k) for k in ('status', 'company', 'ref')}); r['data'] = b.get('data', {}); return self.send(200, r)
                return self.send(404, dict(message='nf'))
            if method == 'DELETE':
                lst[:] = [r for r in lst if r['id'] != rid]; return self.send(204)
        self.send(404, dict(message='unknown ' + p))
    def do_GET(self): self.route('GET')
    def do_POST(self): self.route('POST')
    def do_PUT(self): self.route('PUT')
    def do_DELETE(self): self.route('DELETE')

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5055
    print('mock ERP API on http://localhost:%d  (admin / admin)' % port)
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
