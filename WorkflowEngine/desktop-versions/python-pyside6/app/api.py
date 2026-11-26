"""HTTP client for the Workflow ERP backend (standard library only)."""
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

SESSION_FILE = Path.home() / '.workflow_erp_pyside6.json'
DEFAULT_SERVER = 'http://localhost:63353'


class ApiError(Exception):
    offline = False
    status = 0
    body = {}


@dataclass
class Session:
    server: str
    token: str
    username: str = ''
    display_name: str = ''
    role: str = ''
    tenant: str = ''
    permissions: list = field(default_factory=list)


class Api:
    def __init__(self):
        self.session = None
        self.on_unauthorized = None

    # ---- session
    def load(self):
        try:
            d = json.loads(SESSION_FILE.read_text(encoding='utf-8'))
            self.session = Session(**d)
        except Exception:
            self.session = None
        return self.session

    def _save(self):
        try:
            if self.session:
                SESSION_FILE.write_text(json.dumps(self.session.__dict__), encoding='utf-8')
            elif SESSION_FILE.exists():
                SESSION_FILE.unlink()
        except Exception:
            pass

    def can(self, p):
        return bool(self.session) and p in self.session.permissions

    def sign_out(self):
        self.session = None
        self._save()

    @staticmethod
    def _base(server):
        s = server.strip().rstrip('/')
        if s.lower().endswith('/api'):
            s = s[:-4]
        return s + '/api'

    # ---- low level
    def _call(self, method, path, body=None, server=None, token=None, auth=True):
        s = self.session
        if auth and not s:
            raise ApiError('not signed in')
        url = self._base(server or s.server) + path
        data = None if body is None else json.dumps(body).encode('utf-8')
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        if auth:
            req.add_header('Authorization', 'Bearer ' + (token or s.token))
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                text = r.read().decode('utf-8')
        except urllib.error.HTTPError as e:
            text = e.read().decode('utf-8', 'replace')
            if e.code == 401 and auth:
                self.sign_out()
                if self.on_unauthorized:
                    self.on_unauthorized()
                raise ApiError('401')
            msg, j = text, None
            try:
                j = json.loads(text)
                if isinstance(j, dict):
                    msg = j.get('message') or j.get('error') or j.get('title') or text
            except Exception:
                pass
            ex = ApiError(msg or str(e.code))
            ex.status, ex.body = e.code, (j if isinstance(j, dict) else {})
            raise ex
        except urllib.error.URLError as e:
            ex = ApiError(str(e.reason))
            ex.offline = True
            raise ex
        return json.loads(text) if text.strip() else None

    # ---- auth
    def login(self, server, user, password):
        try:
            j = self._call('POST', '/auth/login', {'username': user, 'password': password}, server=server, auth=False)
        except ApiError:
            raise ApiError('login')
        self.session = Session(server=server.strip(), token=j['token'], username=j.get('username', ''), display_name=j.get('displayName', ''),
                               role=j.get('role', ''), tenant=j.get('tenantName') or '', permissions=list(j.get('permissions') or []))
        self._save()

    def refresh_me(self):
        try:
            j = self._call('GET', '/users/me')
            s = self.session
            s.permissions = list(j.get('effectivePermissions') or s.permissions)
            s.display_name = j.get('displayName') or s.display_name
            s.role = j.get('role') or s.role
            self._save()
        except Exception:
            pass

    # ---- workflow
    def tasks(self): return self._call('GET', '/tasks') or []
    def complete_task(self, tid, decision, comment, form=None): return self._call('POST', f'/tasks/{tid}/complete', {'decision': decision, 'formData': form or {}, 'comment': comment})

    # ---- notes, files and saved filters of a record (same endpoints as the portal's chatter)
    def notes(self, mod, kind, rid): return self._call('GET', f'/collab/{mod}/{kind}/{rid}/notes') or []
    def add_note(self, mod, kind, rid, text): return self._call('POST', f'/collab/{mod}/{kind}/{rid}/notes', {'text': text, 'system': False})
    def del_note(self, nid): return self._call('DELETE', f'/collab/notes/{nid}')
    def files(self, mod, kind, rid): return self._call('GET', f'/collab/{mod}/{kind}/{rid}/files') or []
    def add_file(self, mod, kind, rid, name, ctype, content_b64): return self._call('POST', f'/collab/{mod}/{kind}/{rid}/files', {'name': name, 'type': ctype, 'content': content_b64})
    def del_file(self, fid): return self._call('DELETE', f'/collab/files/{fid}')

    def file_bytes(self, fid):
        s = self.session
        req = urllib.request.Request(self._base(s.server) + f'/collab/files/{fid}', headers={'Authorization': 'Bearer ' + s.token})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise ApiError(e.read().decode('utf-8', 'replace') or str(e.code))
        except urllib.error.URLError as e:
            raise ApiError(str(e.reason))

    def raw(self, path):
        s = self.session
        req = urllib.request.Request(self._base(s.server) + path, headers={'Authorization': 'Bearer ' + s.token})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise ApiError(e.read().decode('utf-8', 'replace') or str(e.code))
        except urllib.error.URLError as e:
            raise ApiError(str(e.reason))

    # ---- calendar and meetings
    def cal(self, method, path, body=None): return self._call(method, '/calendar/' + path, body)

    def filters(self, view): return self._call('GET', '/collab/configs/filter?view=' + urllib.parse.quote(view)) or []
    def save_filter(self, view, name, shared, data): return self._call('POST', '/collab/configs/filter?view=' + urllib.parse.quote(view), {'name': name, 'shared': shared, 'data': data})
    def configs(self, kind, view): return self._call('GET', f'/collab/configs/{kind}?view=' + urllib.parse.quote(view)) or []
    def save_config(self, kind, view, name, shared, data): return self._call('POST', f'/collab/configs/{kind}?view=' + urllib.parse.quote(view), {'name': name, 'shared': shared, 'data': data})
    def del_config(self, kind, cid): return self._call('DELETE', f'/collab/configs/{kind}/{cid}')
    def del_filter(self, fid): return self._call('DELETE', f'/collab/configs/filter/{fid}')
    def instances(self): return self._call('GET', '/instances') or []
    def instance(self, iid): return self._call('GET', f'/instances/{iid}')
    def cancel_instance(self, iid): return self._call('POST', f'/instances/{iid}/cancel', {})
    def definitions(self): return self._call('GET', '/definitions') or []
    # ---- workflow designer
    def wf_definitions(self): return self._call('GET', '/definitions') or []
    def wf_definition(self, did): return self._call('GET', f'/definitions/{did}')
    def wf_save(self, did, body): return self._call('PUT', f'/definitions/{did}', body) if did else self._call('POST', '/definitions', body)
    def wf_publish(self, did): return self._call('POST', f'/definitions/{did}/publish', {})
    def wf_delete(self, did): return self._call('DELETE', f'/definitions/{did}')
    def wf_users(self): return self._call('GET', '/users') or []
    def wf_test_condition(self, expr, data): return self._call('POST', '/definitions/test-condition', {'expression': expr, 'data': data})
    def wf_instances(self): return self._call('GET', '/instances') or []
    def wf_instance(self, iid): return self._call('GET', f'/instances/{iid}')
    def wf_activity(self, iid): return self._call('GET', f'/instances/{iid}/activity-log') or []
    def wf_start(self, did, data=None): return self._call('POST', '/instances/start', {'definitionId': did, 'initialData': data})
    def wf_cancel(self, iid): return self._call('POST', f'/instances/{iid}/cancel', {})
    def start_instance(self, did, data): return self._call('POST', '/instances/start', {'definitionId': did, 'initialData': data})

    # ---- erp
    # Record APIs: most modules live under /erp/<module>; finance, HR, POS and hospital have their own controllers.
    PREFIX = {'fin': '/finance', 'hr': '/hr', 'pos': '/pos', 'hos': '/hospital'}

    def _rec_path(self, module, kind):
        if module == 'hr' and kind == 'employee':
            return '/hr/employees'
        return self.PREFIX.get(module, f'/erp/{module}') + f'/records/{kind}'

    @staticmethod
    def _emp_to_rec(e):
        data = {k: v for k, v in e.items() if k not in ('id', 'empNo', 'status', 'tenantId', 'createdAt', 'updatedAt')}
        return {'id': e.get('id'), 'module': 'hr', 'kind': 'employee', 'code': e.get('empNo'), 'status': e.get('status'), 'company': None, 'ref': None, 'data': data, 'createdBy': None}

    @staticmethod
    def _emp_body(body, rid=None):
        out = dict(body.get('data') or {})
        out['empNo'] = body.get('code')
        out['status'] = body.get('status')
        if rid:
            out['id'] = rid
        return out

    # ---- Setup & administration (users, roles, companies, branches): the portal's Setup screens as record lists
    @staticmethod
    def _adm_rec(kind, x):
        if kind == 'user':
            data = {k: x[k] for k in ('displayName', 'email', 'role') if k in x}
            if x.get('branches'):
                data['branches'] = x['branches']
            if x.get('permissions') is not None:
                data['permissions'] = x['permissions']
            data['newPassword'] = ''
            return {'id': x['id'], 'module': 'adm', 'kind': kind, 'code': x.get('username'), 'status': 'Active' if x.get('isActive', True) else 'Inactive', 'data': data}
        if kind == 'role':
            return {'id': x['role'], 'module': 'adm', 'kind': kind, 'code': x['role'], 'status': 'System' if x.get('isSystem') else 'Custom',
                    'data': {'name': x.get('name') or '', 'users': x.get('users', 0), 'permissions': x.get('permissions', [])}}
        data = {k: v for k, v in x.items() if k != 'code'}
        return {'id': x['code'], 'module': 'adm', 'kind': kind, 'code': x['code'], 'status': 'Active', 'data': data}

    def _adm_records(self, kind):
        if kind == 'user':
            return [self._adm_rec(kind, u) for u in (self._call('GET', '/users/admin') or [])]
        if kind == 'role':
            return [self._adm_rec(kind, r) for r in (self._call('GET', '/admin/rbac') or {}).get('roles', [])]
        snap = self._call('GET', '/org') or {}
        return [self._adm_rec(kind, x) for x in snap.get('companies' if kind == 'company' else 'branches', [])]

    def _adm_write(self, method, kind, rid, body):
        d = body.get('data') or {}
        code = body.get('code') or rid
        if kind == 'user':
            req = {'displayName': d.get('displayName', ''), 'email': d.get('email', ''), 'role': d.get('role', 'employee'),
                   'isActive': body.get('status') != 'Inactive', 'permissions': d.get('permissions'), 'branches': d.get('branches')}
            if method == 'POST':
                req.update(username=code, password=d.get('password') or d.get('newPassword') or '')
                return self._call('POST', '/users/admin', req)
            res = self._call('PUT', f'/users/admin/{rid}', req)
            if d.get('newPassword'):
                self._call('POST', f'/users/admin/{rid}/reset-password', {'password': d['newPassword']})
            return res
        if kind == 'role':
            if method == 'POST':
                req = {'role': code, 'name': d.get('name'), 'copyFrom': d.get('copyFrom')}
                if d.get('permissions'):
                    req['permissions'] = d['permissions']
                return self._call('POST', '/admin/rbac/roles', req)
            return self._call('PUT', f'/admin/rbac/roles/{rid}', {'name': d.get('name'), 'permissions': d.get('permissions') or []})
        path = '/org/companies' if kind == 'company' else '/org/branches'
        req = dict(d, code=code)
        return self._call('POST', path, req) if method == 'POST' else self._call('PUT', f'{path}/{rid}', req)

    def _adm_delete(self, kind, rid):
        path = {'user': '/users/admin', 'role': '/admin/rbac/roles', 'company': '/org/companies', 'branch': '/org/branches'}[kind]
        return self._call('DELETE', f'{path}/{rid}')

    def records(self, module, kind):
        if module == 'adm':
            return self._adm_records(kind)
        if module == 'hr' and kind == 'employee':
            return [self._emp_to_rec(e) for e in (self._call('GET', '/hr/employees') or [])]
        return self._call('GET', self._rec_path(module, kind) + '?take=500') or []

    def create_record(self, module, kind, body):
        if module == 'adm':
            return self._adm_write('POST', kind, None, body)
        if module == 'hr' and kind == 'employee':
            return self._call('POST', '/hr/employees', self._emp_body(body))
        return self._call('POST', self._rec_path(module, kind), body)

    def update_record(self, module, kind, rid, body):
        if module == 'adm':
            return self._adm_write('PUT', kind, rid, body)
        if module == 'hr' and kind == 'employee':
            return self._call('PUT', f'/hr/employees/{rid}', self._emp_body(body, rid))
        return self._call('PUT', f'{self._rec_path(module, kind)}/{rid}', body)

    def delete_record(self, module, kind, rid):
        if module == 'adm':
            return self._adm_delete(kind, rid)
        return self._call('DELETE', f'{self._rec_path(module, kind)}/{rid}')

    # ---- hospital (generic: the screens are described by data/hospital.json)
    def hos(self, method, path, body=None, **q):
        qs = urllib.parse.urlencode({k: v for k, v in q.items() if v not in (None, '')})
        return self._call(method, '/hospital/' + path + ('?' + qs if qs else ''), body)

    # ---- finance reports (the records themselves are the generic /finance/records/<kind>)
    def fin(self, method, path, body=None, **q):
        qs = urllib.parse.urlencode({k: v for k, v in q.items() if v not in (None, '')})
        return self._call(method, '/finance/' + path + ('?' + qs if qs else ''), body)

    # ---- HR reports and the employee import (the lists are the generic /hr/records/<kind> and /hr/employees)
    def hr(self, method, path, body=None, **q):
        qs = urllib.parse.urlencode({k: v for k, v in q.items() if v not in (None, '')})
        return self._call(method, '/hr/' + path + ('?' + qs if qs else ''), body)

    # ---- point of sale
    def pos_records(self, kind, **q):
        qs = urllib.parse.urlencode({k: v for k, v in q.items() if v not in (None, '')})
        return self._call('GET', f'/pos/records/{kind}' + ('?' + qs if qs else '')) or []
    def pos_checkout(self, body): return self._call('POST', '/pos/sales/checkout', body)
    def pos_return(self, sid, lines, method, reason): return self._call('POST', f'/pos/sales/{sid}/return', {'lines': lines, 'method': method, 'reason': reason})
    def pos_void(self, sid): return self._call('POST', f'/pos/sales/{sid}/void', {})
    def pos_shift(self): return self._call('GET', '/pos/shifts/current')
    def pos_open(self, body): return self._call('POST', '/pos/shifts/open', body)
    def pos_cash(self, sid, typ, amount, reason): return self._call('POST', f'/pos/shifts/{sid}/cash', {'type': typ, 'amount': amount, 'reason': reason})
    def pos_close(self, sid, counted, note): return self._call('POST', f'/pos/shifts/{sid}/close', {'countedCash': counted, 'note': note})

    def biz_action(self, module, kind, rid, op, body): return self._call('POST', f'/erp/{module}/bizact/{kind}/{rid}/{op}', body or {})
    def approval_act(self, aid, op, note): return self._call('POST', f'/erp/gov/approvals/{aid}/{op}', {'note': note})


api = Api()
