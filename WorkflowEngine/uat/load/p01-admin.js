// Workspace administrator: users, privileges and roles, organisation, workflow designer and instances, BPM, integration (keys, webhooks, read API), BI, billing, audit.
// Works only on its own temporary users / roles / branch / flows and never touches the other 19 users or switches a module off.
const { Client, BASE, refused } = require('../lib');
const { must, eq, ok } = require('./_fin');

const PW = process.env.UAT_PASSWORD || 'Test@12345';
const NEWPW = 'Changed@67890';
const raw = async (path, key) => {   // the public read API: no bearer token, only X-Api-Key
  const r = await fetch(BASE + path, { headers: key ? { 'X-Api-Key': key } : {} });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
};

module.exports = {
  id: 'admin',
  title: 'Workspace administrator',
  modules: ['admin', 'org', 'workflow', 'bpm', 'integration', 'bi', 'rbac', 'billing'],
  role: 'admin',
  perms: ['admin.*', 'org.*', 'wf.*', 'bpm.*', 'int.*', 'bi.*'],
  probe: { path: '/api/users/admin', perm: 'admin.users' },

  async run(u) {
    const c = u.c, K = u.key, k = K.toLowerCase(), S = u.state, CO = u.ws.company;
    S.ua = `${u.username}a`; S.ub = `${u.username}b`;
    const ROLE = `qa-${k}`, KEY = `adm.x${k}`, BRC = `X${K}`;
    const users = async () => must(await c.get('/api/users/admin'), 'user list');
    const byName = async n => (await users()).find(x => x.username === n);
    const loginRaw = (name, pw) => new Client(name).post('/api/auth/login', { username: name, password: pw });
    const saveUser = (x, patch = {}) => c.put(`/api/users/admin/${x.id}`, Object.assign({ displayName: x.displayName, email: x.email, role: x.role, isActive: x.isActive, permissions: x.permissions, branches: x.branches }, patch));
    const rbac = async () => must(await c.get('/api/admin/rbac'), 'rbac');

    await u.step('ADM-01', 'Create a user: listed, effective privileges from the role, duplicate / short password / no name refused, can sign in', async () => {
      const before = (await users()).length;
      const r = must(await c.post('/api/users/admin', { username: S.ua, displayName: 'Temp A ' + K, email: `${S.ua}@example.com`, role: 'employee', password: PW, isActive: true }), 'create user');
      S.uaId = r.id; eq(r.role, 'employee', 'role'); ok(r.isActive === true, 'active'); ok(r.effectivePermissions.includes('dashboard.view'), 'employee default privilege'); ok(!r.effectivePermissions.includes('finance.gl.manage'), 'no finance rights');
      { const now = await users(); ok(now.some(x => x.username === S.ua), 'new user is listed'); ok(now.length >= before + 1, 'user count ' + now.length + ' (was ' + before + '); other people may add users at the same time'); }
      refused(await c.post('/api/users/admin', { username: S.ua, displayName: 'dup', role: 'employee', password: PW }), 'duplicate username', [409]);
      refused(await c.post('/api/users/admin', { username: S.ua + 'x', displayName: 'short', role: 'employee', password: '123' }), 'short password', [400]);
      refused(await c.post('/api/users/admin', { username: '', displayName: 'none', role: 'employee', password: PW }), 'no username', [400]);
      const cl = new Client(S.ua); await cl.login(S.ua, PW); S.ca = cl;
      const me = must(await cl.get('/api/users/me'), 'me'); eq(me.username, S.ua, 'me.username');
      return `${S.ua} created (${before} -> ${before + 1} users) and signed in`;
    });

    await u.step('ADM-02', 'Edit a user: role to finance gives finance rights, custom privilege list replaces the role, branch limit, back to role defaults', async () => {
      ok(S.uaId, 'depends on ADM-01');
      let x = await byName(S.ua);
      let r = must(await saveUser(x, { role: 'finance', permissions: null, displayName: 'Temp A edited ' + K }), 'role finance'); eq(r.displayName, 'Temp A edited ' + K, 'display name');
      ok(r.effectivePermissions.includes('finance.gl.manage'), 'finance role has GL rights');
      r = must(await saveUser(x, { role: 'finance', permissions: ['dashboard.view', 'crm.view'] }), 'custom privileges');
      ok(r.effectivePermissions.includes('crm.view') && !r.effectivePermissions.includes('finance.gl.manage'), 'custom list replaces the role: ' + r.effectivePermissions.length);
      r = must(await saveUser(x, { role: 'finance', permissions: ['dashboard.view'], branches: [u.ws.branch.RYD] }), 'branch limit'); eq(JSON.stringify(r.branches), JSON.stringify([u.ws.branch.RYD]), 'branches');
      r = must(await saveUser(x, { role: 'employee', permissions: null, branches: [] }), 'back to defaults'); ok(r.branches == null, 'branch limit removed'); ok(!r.effectivePermissions.includes('finance.gl.manage'), 'employee again');
      return 'role / custom list / branch limit applied and reverted';
    });

    await u.step('ADM-03', 'User lifecycle: deactivate blocks sign-in, reactivate restores it, reset password (old refused, new works, short refused)', async () => {
      ok(S.uaId, 'depends on ADM-01');
      let x = await byName(S.ua);
      must(await saveUser(x, { isActive: false }), 'deactivate'); refused(await loginRaw(S.ua, PW), 'sign-in of a deactivated user', [400, 401, 403]);
      eq((await byName(S.ua)).isActive, false, 'flag stored');
      x = await byName(S.ua); must(await saveUser(x, { isActive: true }), 'reactivate'); const ok1 = await loginRaw(S.ua, PW); ok(ok1.ok, 'sign-in after reactivation: HTTP ' + ok1.status);
      refused(await c.post(`/api/users/admin/${S.uaId}/reset-password`, { password: '12' }), 'short reset password', [400]);
      must(await c.post(`/api/users/admin/${S.uaId}/reset-password`, { password: NEWPW }), 'reset password');
      refused(await loginRaw(S.ua, PW), 'old password after reset', [400, 401, 403]); ok((await loginRaw(S.ua, NEWPW)).ok, 'new password works');
      refused(await c.post('/api/users/admin/nope-' + k + '/reset-password', { password: NEWPW }), 'reset for unknown user', [404]);
      return 'deactivate / reactivate / reset ok';
    });

    await u.step('ADM-04', 'Invite: user without password gets a link token (pending), sign-in refused, invite re-issued; a user with a password cannot be invited', async () => {
      const r = must(await c.post('/api/users/admin', { username: S.ub, displayName: 'Temp B ' + K, email: `${S.ub}@example.com`, role: 'employee', invite: true, isActive: true }), 'invite user');
      S.ubId = r.id; ok(r.invitePending === true, 'invitePending'); ok(String(r.inviteToken || '').length > 20, 'invite token');
      refused(await loginRaw(S.ub, PW), 'sign-in before accepting', [400, 401, 403]);
      const again = must(await c.post(`/api/users/admin/${S.ubId}/invite`, {}), 'invite again'); ok(String(again.inviteToken || '').length > 20, 're-issued token');
      if (S.uaId) refused(await c.post(`/api/users/admin/${S.uaId}/invite`, {}), 'invite a user that has a password', [400]);
      return 'token issued and re-issued';
    });

    await u.step('ADM-05', 'Guard rails: cannot deactivate or delete yourself, unknown user 404, the directory and permission catalog are readable', async () => {
      const me = await byName(u.username); ok(me, 'own user not listed');
      refused(await saveUser(me, { isActive: false }), 'deactivate yourself', [400]);
      refused(await saveUser(me, { role: 'employee', permissions: ['dashboard.view'] }), 'remove own admin access', [400]);
      refused(await c.del(`/api/users/admin/${me.id}`), 'delete yourself', [400]);
      refused(await c.del('/api/users/admin/nope-' + k), 'delete unknown user', [404]);
      const dir = must(await c.get('/api/users'), 'directory'); ok(dir.some(x => x.username === u.username), 'directory lists me'); ok(dir.every(x => x.passwordHash === undefined && x.password === undefined), 'no password fields');
      const cat = must(await c.get('/api/users/permissions'), 'catalog'); ok(cat.groups.length >= 10, 'groups'); ok(cat.roles.includes('admin') && cat.roles.includes('finance'), 'roles'); ok(cat.roleDefaults.finance.includes('finance.gl.manage'), 'finance defaults');
      return 'self-lockout refused; ' + cat.groups.length + ' privilege groups';
    });

    await u.step('ADM-06', 'Custom role: create (dup / bad code refused), edit privileges, copy from another role, assign to a user, delete only when empty', async () => {
      ok(S.uaId, 'depends on ADM-01');
      let d = must(await c.post('/api/admin/rbac/roles', { role: ROLE, name: 'QA ' + K, permissions: ['crm.view', 'dashboard.view'] }), 'create role');
      let role = d.roles.find(r => r.role === ROLE); ok(role, 'role missing'); ok(role.isSystem === false, 'custom role'); ok(role.permissions.includes('crm.view'), 'privilege'); eq(role.users, 0, 'users');
      refused(await c.post('/api/admin/rbac/roles', { role: ROLE, permissions: [] }), 'duplicate role', [409]);
      refused(await c.post('/api/admin/rbac/roles', { role: 'Bad Role!', permissions: [] }), 'bad role code', [400]);
      d = must(await c.put(`/api/admin/rbac/roles/${ROLE}`, { permissions: ['crm.view', 'crm.leads.manage', 'dashboard.view', 'not.a.privilege'] }), 'edit role');
      role = d.roles.find(r => r.role === ROLE); eq(role.permissions.length, 3, 'unknown privilege dropped'); ok(role.permissions.includes('crm.leads.manage'), 'edited');
      refused(await c.put('/api/admin/rbac/roles/admin', { permissions: [] }), 'edit admin role', [400]);
      refused(await c.put('/api/admin/rbac/roles/nope-' + k, { permissions: [] }), 'edit unknown role', [404]);
      d = must(await c.post('/api/admin/rbac/roles', { role: ROLE + '-c', copyFrom: 'sales' }), 'copy role');
      const copy = d.roles.find(r => r.role === ROLE + '-c'), sales = d.roles.find(r => r.role === 'sales'); ok(copy.permissions.length > 5 && copy.permissions.length === sales.permissions.length, 'copy has the sales privileges');
      must(await c.del(`/api/admin/rbac/roles/${ROLE}-c`), 'delete copy');
      const x = await byName(S.ua); const r = must(await saveUser(x, { role: ROLE, permissions: null }), 'assign role');
      ok(r.effectivePermissions.includes('crm.leads.manage') && !r.effectivePermissions.includes('finance.gl.manage'), 'user follows the custom role');
      refused(await c.del(`/api/admin/rbac/roles/${ROLE}`), 'delete role in use', [400]);
      must(await saveUser(await byName(S.ua), { role: 'employee', permissions: null }), 'move user back');
      d = must(await c.del(`/api/admin/rbac/roles/${ROLE}`), 'delete role'); ok(!d.roles.some(q => q.role === ROLE), 'role gone');
      refused(await c.del(`/api/admin/rbac/roles/${ROLE}`), 'delete role twice', [404]);
      return 'role ' + ROLE + ' created, edited, assigned, deleted';
    });

    await u.step('ADM-07', 'Custom privilege: add, duplicate / bad key refused, switch off and on, locked privilege cannot be switched off, delete', async () => {
      let d = must(await c.post('/api/admin/rbac/permissions', { key: KEY, label: 'Test ' + K, group: 'adm', route: '/adm' }), 'add privilege');
      const p = d.permissions.find(x => x.key === KEY); ok(p && p.isCustom && p.isActive, 'custom privilege active');
      refused(await c.post('/api/admin/rbac/permissions', { key: KEY }), 'duplicate privilege', [409]);
      refused(await c.post('/api/admin/rbac/permissions', { key: 'Bad Key' }), 'bad key', [400]);
      d = must(await c.put(`/api/admin/rbac/permissions/${KEY}`, { isActive: false, label: 'Renamed ' + K }), 'switch off'); eq(d.permissions.find(x => x.key === KEY).isActive, false, 'off'); eq(d.permissions.find(x => x.key === KEY).label, 'Renamed ' + K, 'label');
      d = must(await c.put(`/api/admin/rbac/permissions/${KEY}`, { isActive: true }), 'switch on'); eq(d.permissions.find(x => x.key === KEY).isActive, true, 'on');
      refused(await c.put('/api/admin/rbac/permissions/admin.users', { isActive: false }), 'switch off admin.users', [400]);
      refused(await c.put('/api/admin/rbac/permissions/zz.nothing', { isActive: false }), 'unknown privilege', [404]);
      d = must(await c.del(`/api/admin/rbac/permissions/${KEY}`), 'delete privilege'); ok(!d.permissions.some(x => x.key === KEY), 'privilege gone');
      refused(await c.del(`/api/admin/rbac/permissions/${KEY}`), 'delete twice', [404]);
      return KEY + ' added, toggled, deleted; ' + d.permissions.length + ' privileges in catalog';
    });

    await u.step('ADM-08', 'A user without admin privileges is refused by the admin, organisation, billing, designer and integration APIs', async () => {
      ok(S.ca, 'depends on ADM-01');
      const e = S.ca; const R = (r, w) => refused(r, w, [401, 403]);
      R(await e.get('/api/users/admin'), 'user list'); R(await e.post('/api/users/admin', { username: S.ua + 'z', password: PW }), 'create user'); R(await e.get('/api/admin/rbac'), 'rbac');
      R(await e.put('/api/org/modules', { enabled: ['hr'] }), 'module switch'); R(await e.post('/api/org/branches', { code: 'ZZ' + k, name: 'x', company: CO }), 'create branch');
      R(await e.get('/api/billing/summary'), 'billing'); R(await e.post('/api/definitions', { name: 'x' }), 'create flow'); R(await e.post('/api/erp/int/apikeys', { name: 'x' }), 'api key');
      ok((await e.get('/api/org')).ok, 'an employee may still read the organisation (pickers)');
      return '8 admin calls refused, org read allowed';
    });

    await u.step('ADM-09', 'Organisation: tenant plan and counts, branch create / update / delete with refusals, company update, extra company limit, last company protected', async () => {
      const o = must(await c.get('/api/org'), 'org'); const t = o.tenant;
      eq(t.plan, 'starter', 'plan'); eq(t.maxUsers, 25, 'max users'); eq(t.maxCompanies, 1, 'max companies'); eq(t.companies, o.companies.length, 'company count'); ok(o.branches.length >= 3, 'branches');
      const b = must(await c.post('/api/org/branches', { code: BRC, company: CO, name: 'Branch ' + K, nameAr: 'فرع ' + K, city: 'Tabuk' }), 'create branch'); eq(b.code, BRC, 'code'); eq(b.warehouse, 'WH-' + BRC, 'default warehouse');
      refused(await c.post('/api/org/branches', { code: BRC, company: CO, name: 'dup' }), 'duplicate branch', [409]);
      refused(await c.post('/api/org/branches', { code: 'bad code!', company: CO, name: 'x' }), 'bad branch code', [400]);
      refused(await c.post('/api/org/branches', { code: BRC + 'Q', company: 'NOPE', name: 'x' }), 'unknown company', [400]);
      refused(await c.post('/api/org/branches', { code: BRC + 'R', company: CO, name: '' }), 'branch without name', [400]);
      const up = must(await c.put(`/api/org/branches/${BRC}`, { code: BRC, company: CO, name: 'Branch renamed ' + K, city: 'Abha', warehouse: 'WH-X-' + K }), 'update branch'); eq(up.city, 'Abha', 'city'); eq(up.warehouse, 'WH-X-' + K, 'warehouse');
      ok((await c.get('/api/org')).data.branches.some(x => x.code === BRC && x.name === 'Branch renamed ' + K), 'branch in the snapshot');
      refused(await c.put('/api/org/branches/NOPE' + k, { name: 'x' }), 'update unknown branch', [404]);
      const comp = o.companies.find(x => x.code === CO); const cu = must(await c.put(`/api/org/companies/${CO}`, { code: CO, name: comp.name, nameAr: comp.nameAr, currency: comp.currency, taxNo: '3000' + k, country: comp.country }), 'update company'); eq(cu.taxNo, '3000' + k, 'tax no');
      const second = await c.post('/api/org/companies', { code: 'C' + K, name: 'Second ' + K, currency: 'SAR' });
      if (second.status !== 402) { ok(second.ok, 'second company: HTTP ' + second.status); must(await c.del('/api/org/companies/C' + K), 'remove test company'); }
      else refused(second, 'second company on starter plan', [402]);
      if (o.companies.length === 1) refused(await c.del(`/api/org/companies/${CO}`), 'delete the last company', [400]);
      refused(await c.post('/api/org/companies', { code: 'bad code', name: 'x' }), 'bad company code', [400, 402]);
      must(await c.del(`/api/org/branches/${BRC}`), 'delete branch'); ok(!(await c.get('/api/org')).data.branches.some(x => x.code === BRC), 'branch removed');
      refused(await c.del(`/api/org/branches/${BRC}`), 'delete branch twice', [404]);
      return `plan ${t.plan}: ${t.users} users, ${t.companies} company, ${t.branches} branches; company limit ${second.status === 402 ? 'enforced (402)' : 'not reached'}`;
    });

    await u.step('ADM-10', 'Module switches: list of 21 modules, saving the same set is accepted, unknown module names are dropped (no module is switched off)', async () => {
      const m = must(await c.get('/api/org/modules'), 'modules'); ok(m.all.length >= 20, 'catalog size ' + m.all.length);
      for (const key of ['hr', 'finance', 'pos', 'epm', 'bpm', 'int', 'bi', 'workflow']) ok(m.all.includes(key), 'module ' + key);
      const r = must(await c.put('/api/org/modules', { enabled: m.enabled.concat(['zz-' + k]) }), 'save modules');
      eq(JSON.stringify([...r.enabled].sort()), JSON.stringify([...m.enabled].sort()), 'unknown module dropped, rest unchanged');
      const after = must(await c.get('/api/org/modules'), 'modules again'); eq(after.enabled.length, m.enabled.length, 'enabled count'); ok(after.restricted === true, 'explicit list');
      return m.enabled.length + ' of ' + m.all.length + ' modules enabled, unchanged';
    });
    u.manual('ADM-10b', 'Switching a module off removes its privileges and menu at once', 'Not done through the API in this run: it would break the other 19 users who work in the same workspace at the same time');

    // ---- workflow designer
    const nid = x => `${K}-${x}`;
    const flow = (name) => ({ name, description: 'Approval flow ' + K, nodes: [
      { id: nid('s'), type: 'Start', name: 'Start', x: 50, y: 100 },
      { id: nid('l'), type: 'Logger', name: 'Log', x: 200, y: 100, logMessage: 'Started with {{amount}}' },
      { id: nid('c'), type: 'Condition', name: 'Big?', x: 350, y: 100, conditionExpression: 'amount > 1000' },
      { id: nid('a'), type: 'ApprovalTask', name: 'Approve it', x: 500, y: 50, assignee: u.username, description: 'Check ' + K, form: { title: 'Decision', fields: [{ key: 'note', label: 'Note', type: 'Text' }] } },
      { id: nid('e1'), type: 'End', name: 'Done', x: 700, y: 100 },
      { id: nid('e2'), type: 'End', name: 'Rejected', x: 700, y: 200 }],
      edges: [
        { id: nid('1'), sourceNodeId: nid('s'), targetNodeId: nid('l'), label: 'Default' }, { id: nid('2'), sourceNodeId: nid('l'), targetNodeId: nid('c'), label: 'Default' },
        { id: nid('3'), sourceNodeId: nid('c'), targetNodeId: nid('a'), label: 'True' }, { id: nid('4'), sourceNodeId: nid('c'), targetNodeId: nid('e1'), label: 'False' },
        { id: nid('5'), sourceNodeId: nid('a'), targetNodeId: nid('e1'), label: 'Approve' }, { id: nid('6'), sourceNodeId: nid('a'), targetNodeId: nid('e2'), label: 'Reject' }] });

    await u.step('ADM-11', 'Workflow designer: create a flow, edit, publish (a flow without Start / End cannot be published), test a condition, list, read', async () => {
      const d = must(await c.post('/api/definitions', flow('Flow ' + K)), 'create flow'); S.def = d; ok(d.id, 'id'); eq(d.nodes.length, 6, 'nodes'); eq(d.isPublished, false, 'not published yet');
      const e = must(await c.put(`/api/definitions/${d.id}`, Object.assign(flow('Flow renamed ' + K), { description: 'edited' })), 'edit flow'); eq(e.name, 'Flow renamed ' + K, 'name'); eq(e.description, 'edited', 'description');
      const bad = must(await c.post('/api/definitions', { name: 'Broken ' + K, nodes: [{ id: nid('x'), type: 'End', name: 'End' }], edges: [] }), 'create broken flow');
      refused(await c.post(`/api/definitions/${bad.id}/publish`, {}), 'publish without Start', [400]);
      const p = must(await c.post(`/api/definitions/${d.id}/publish`, {}), 'publish'); eq(p.isPublished, true, 'published');
      eq(must(await c.post('/api/definitions/test-condition', { expression: 'amount > 1000', data: { amount: 1500 } }), 'condition true').result, true, 'amount 1500 > 1000');
      eq(must(await c.post('/api/definitions/test-condition', { expression: 'amount > 1000', data: { amount: 500 } }), 'condition false').result, false, 'amount 500 > 1000');
      eq(must(await c.post('/api/definitions/test-condition', { expression: "amount > 1000 && region == 'N'", data: { amount: 1500, region: 'S' } }), 'condition and').result, false, 'and-chain');
      ok(must(await c.get('/api/definitions'), 'list').some(x => x.id === d.id), 'flow listed'); eq(must(await c.get(`/api/definitions/${d.id}`), 'read').id, d.id, 'read');
      refused(await c.get('/api/definitions/nope' + k), 'unknown flow', [404]); refused(await c.put('/api/definitions/nope' + k, flow('x')), 'edit unknown flow', [404]);
      must(await c.del(`/api/definitions/${bad.id}`), 'delete broken flow');
      return 'flow ' + d.id.slice(0, 8) + ' published';
    });

    await u.step('ADM-12', 'Workflow instances: big amount waits for approval and completes on Approve; small amount skips approval; invalid decision refused; Reject path; cancel; activity log; monitor list', async () => {
      ok(S.def, 'depends on ADM-11');
      const start = async amount => must(await c.post('/api/instances/start', { definitionId: S.def.id, initialData: { amount } }), 'start instance');
      const taskOf = async id => { const t = must(await c.get('/api/tasks'), 'tasks').find(x => x.instanceId === id); return t; };
      const A = await start(5000); eq(A.status, 'Running', 'A running'); ok(A.history.some(h => h.action === 'Logged'), 'logger step recorded');
      const tA = await taskOf(A.id); ok(tA, 'approval task for A'); ok(tA.availableDecisions.includes('Approve') && tA.availableDecisions.includes('Reject'), 'decisions');
      refused(await c.post(`/api/tasks/${tA.id}/complete`, { decision: 'Maybe' }), 'invalid decision', [400]);
      must(await c.post(`/api/tasks/${tA.id}/complete`, { decision: 'Approve', comment: 'ok ' + K, formData: { note: 'fine' } }), 'approve');
      const A2 = must(await c.get(`/api/instances/${A.id}`), 'read A'); eq(A2.status, 'Completed', 'A completed'); eq(A2.data.note, 'fine', 'form data merged');
      refused(await c.post(`/api/tasks/${tA.id}/complete`, { decision: 'Approve' }), 'complete twice', [400]);
      const B = await start(10); eq(B.status, 'Completed', 'B completes without approval'); ok(!(await taskOf(B.id)), 'no task for B');
      const D = await start(9000); const tD = await taskOf(D.id); must(await c.post(`/api/tasks/${tD.id}/complete`, { decision: 'Reject' }), 'reject');
      const D2 = must(await c.get(`/api/instances/${D.id}`), 'read D'); eq(D2.status, 'Completed', 'D ended on the Reject branch'); ok(D2.history.some(h => /Reject/i.test(h.action)), 'Reject in history');
      const C = await start(7000); const cc = must(await c.post(`/api/instances/${C.id}/cancel`, {}), 'cancel'); eq(cc.status, 'Terminated', 'terminated');
      refused(await c.post(`/api/instances/${C.id}/cancel`, {}), 'cancel twice', [400]);
      const log = must(await c.get(`/api/instances/${A.id}/activity-log`), 'activity log'); ok(log.length >= 4, 'activity rows ' + log.length);
      const all = must(await c.get('/api/instances'), 'monitor'); for (const i of [A, B, C, D]) ok(all.some(x => x.id === i.id), 'instance ' + i.id.slice(0, 6) + ' in the monitor');
      refused(await c.post('/api/instances/start', { definitionId: 'nope' + k }), 'start unknown flow', [404]); refused(await c.get('/api/instances/nope' + k), 'read unknown instance', [404]);
      S.inst = [A.id, B.id, C.id, D.id];
      return '4 instances: approved, auto, cancelled, rejected';
    });

    // ---- BPM (generic records of the bpm module)
    await u.step('ADM-13', 'BPM processes: create two with SLA hours, update, deactivate, duplicate code refused, KPI processes / average SLA follow the list, settings', async () => {
      const mk = (name, sla, extra = {}) => c.post('/api/erp/bpm/records/process', Object.assign({ company: CO, data: { name, owner: u.username, slaHours: sla, steps: 4 } }, extra));
      const p1 = must(await mk('Onboarding ' + K, 8), 'process 1'), p2 = must(await mk('Purchasing ' + K, 16), 'process 2');
      ok(/^PRC-\d{4}-\d{4}$/.test(p1.code), 'number ' + p1.code); eq(p1.status, 'Active', 'status');
      refused(await mk('dup', 1, { code: p1.code }), 'duplicate process code', [409]);
      const up = must(await c.put(`/api/erp/bpm/records/process/${p2.id}`, { status: 'Active', data: Object.assign({}, p2.data, { slaHours: 24 }) }), 'update'); eq(up.data.slaHours, 24, 'sla');
      const list = must(await c.get('/api/erp/bpm/records/process'), 'list'); const active = list.filter(x => x.status === 'Active');
      const s = must(await c.get('/api/erp/bpm/summary'), 'summary'); const kpi = n => (s.kpis.find(x => x.k === n) || {}).v;
      ok(kpi('processes') >= 2, 'processes kpi ' + kpi('processes'));
      const avg = Math.round(active.reduce((t, x) => t + Number(x.data.slaHours || 0), 0) / active.length * 10) / 10; eq(kpi('avgSla'), avg, 'average SLA over the active processes', 0.11);
      const off = must(await c.put(`/api/erp/bpm/records/process/${p1.id}`, { status: 'Inactive', data: p1.data }), 'deactivate'); eq(off.status, 'Inactive', 'inactive');
      const st = must(await c.post('/api/erp/bpm/records/setting', { code: 'cfg-' + k, company: CO, data: { escalate: true } }), 'setting'); eq(st.code, 'cfg-' + k, 'setting code');
      refused(await c.post('/api/erp/bpm/records/setting', { company: CO, data: {} }), 'setting without code', [400]);
      must(await c.del(`/api/erp/bpm/records/setting/${st.id}`), 'delete setting'); must(await c.del(`/api/erp/bpm/records/process/${p1.id}`), 'delete process 1'); must(await c.del(`/api/erp/bpm/records/process/${p2.id}`), 'delete process 2');
      refused(await c.get('/api/erp/nomodule/records/process'), 'unknown module', [404]);
      return `average SLA ${avg} h over ${active.length} active`;
    });

    // ---- Integration
    await u.step('ADM-14', 'API keys: secret shown once, scopes enforced on the read API, wrong / missing key 401, revoke and re-enable, unknown module 404', async () => {
      refused(await c.post('/api/erp/int/apikeys', { name: '' }), 'key without name', [400]);
      refused(await c.post('/api/erp/int/records/apikey', { data: { name: 'direct' } }), 'create a key by hand', [400]);
      const k1 = must(await c.post('/api/erp/int/apikeys', { name: 'Reader ' + K, scopes: ['crm:lead', 'EPM:plan'] }), 'create key'); S.key1 = k1;
      ok(/^wk_[0-9a-f]{40}$/.test(k1.key), 'secret format'); eq(k1.prefix, k1.key.slice(0, 11), 'prefix');
      const k2 = must(await c.post('/api/erp/int/apikeys', { name: 'All ' + K }), 'key without scopes'); S.key2 = k2;
      const list = await c.get('/api/erp/int/records/apikey'); const rows = must(list, 'list keys'); ok(!list.text.includes(k1.key), 'the secret must not be listed');
      eq(JSON.stringify(rows.find(x => x.id === k2.id).data.scopes), JSON.stringify(['*']), 'default scope');
      const rd = await raw('/api/integration/v1/crm/lead', k1.key); eq(rd.status, 200, 'crm lead read'); ok(Array.isArray(rd.data), 'array');
      eq((await raw('/api/integration/v1/epm/plan', k1.key)).status, 200, 'scope is case-insensitive (epm:plan)');
      eq((await raw('/api/integration/v1/mfg/workorder', k1.key)).status, 403, 'mfg not in scope');
      eq((await raw('/api/integration/v1/mfg/workorder', k2.key)).status, 200, '* scope reads mfg');
      eq((await raw('/api/integration/v1/pay/run', k2.key)).status, 404, 'payroll is not exposed');
      eq((await raw('/api/integration/v1/crm/lead')).status, 401, 'no key'); eq((await raw('/api/integration/v1/crm/lead', 'wk_' + '0'.repeat(40))).status, 401, 'wrong key');
      const k1rec = rows.find(x => x.id === k1.id);
      must(await c.put(`/api/erp/int/records/apikey/${k1.id}`, { status: 'Inactive', data: k1rec.data }), 'revoke'); eq((await raw('/api/integration/v1/crm/lead', k1.key)).status, 401, 'revoked key');
      must(await c.put(`/api/erp/int/records/apikey/${k1.id}`, { status: 'Active', data: k1rec.data }), 're-enable'); eq((await raw('/api/integration/v1/crm/lead', k1.key)).status, 200, 're-enabled key');
      const used = must(await c.get('/api/erp/int/records/apikey'), 'list again').find(x => x.id === k1.id); ok(used.data.lastUsed, 'last used recorded');
      must(await c.del(`/api/erp/int/records/apikey/${k1.id}`), 'delete key 1'); must(await c.del(`/api/erp/int/records/apikey/${k2.id}`), 'delete key 2');
      eq((await raw('/api/integration/v1/crm/lead', k2.key)).status, 401, 'deleted key');
      return 'scopes, revoke and delete behave';
    });

    await u.step('ADM-15', 'Webhooks and connectors: create, test delivery logged as Failed (closed port / bad URL), logs are system-only, update and delete', async () => {
      const h = must(await c.post('/api/erp/int/records/webhook', { company: CO, data: { name: 'Hook ' + K, url: 'http://127.0.0.1:9/hook', events: 'never.' + k, secret: 's3cret' } }), 'create webhook');
      ok(/^WH-\d{4}-\d{4}$/.test(h.code), 'number ' + h.code);
      const t = must(await c.post(`/api/erp/int/webhooks/${h.id}/test`, {}), 'test webhook'); eq(t.ok, false, 'delivery to a closed port fails'); ok(String(t.message).length > 0, 'failure reason');
      const log = must(await c.get('/api/erp/int/records/log'), 'logs').filter(x => x.ref === h.code); ok(log.length >= 1 && log[0].status === 'Failed', 'failed delivery logged');
      refused(await c.post('/api/erp/int/records/log', { data: {} }), 'create a log by hand', [400]);
      const h2 = must(await c.put(`/api/erp/int/records/webhook/${h.id}`, { status: 'Active', data: Object.assign({}, h.data, { url: 'not-a-url' }) }), 'edit url');
      const t2 = must(await c.post(`/api/erp/int/webhooks/${h.id}/test`, {}), 'test bad url'); eq(t2.ok, false, 'bad url fails'); ok(/invalid/i.test(t2.message), 'message: ' + t2.message);
      refused(await c.post('/api/erp/int/webhooks/nope' + k + '/test', {}), 'test unknown webhook', [404]);
      const off = must(await c.put(`/api/erp/int/records/webhook/${h.id}`, { status: 'Inactive', data: h2.data }), 'deactivate'); eq(off.status, 'Inactive', 'inactive');
      const cn = must(await c.post('/api/erp/int/records/connector', { company: CO, data: { name: 'Connector ' + K, type: 'REST', endpoint: 'https://example.com/api' } }), 'connector'); ok(/^CN-/.test(cn.code), 'connector number');
      const s = must(await c.get('/api/erp/int/summary'), 'int summary'); ok(Array.isArray(s.kpis), 'summary kpis');
      for (const l of log) must(await c.del(`/api/erp/int/records/log/${l.id}`), 'delete log');
      must(await c.del(`/api/erp/int/records/connector/${cn.id}`), 'delete connector'); must(await c.del(`/api/erp/int/records/webhook/${h.id}`), 'delete webhook');
      return 'webhook ' + h.code + ': 2 test deliveries failed as expected';
    });

    await u.step('ADM-16', 'BI: overview of the modules, insights list, saved report create / update / delete, no summary for bi, finance audit readable by admin only', async () => {
      const ov = must(await c.get('/api/erp/bi/overview'), 'overview'); ok(ov.length >= 8, 'modules in overview ' + ov.length); for (const m of ['bpm', 'epm', 'int']) ok(ov.some(x => x.module === m), 'module ' + m + ' in overview');
      const ins = must(await c.get('/api/erp/bi/insights'), 'insights'); ok(Array.isArray(ins) && ins.every(x => x.code && x.module && x.level), 'insights shape');
      const r = must(await c.post('/api/erp/bi/records/report', { company: CO, data: { name: 'Report ' + K, module: 'finance', metric: 'revenueYtd', chart: 'bar' } }), 'save report'); ok(/^RPT-\d{4}-\d{4}$/.test(r.code), 'report number ' + r.code);
      const up = must(await c.put(`/api/erp/bi/records/report/${r.id}`, { status: 'Active', data: Object.assign({}, r.data, { chart: 'line' }) }), 'update report'); eq(up.data.chart, 'line', 'chart');
      ok(must(await c.get('/api/erp/bi/records/report'), 'reports').some(x => x.id === r.id), 'report listed');
      must(await c.del(`/api/erp/bi/records/report/${r.id}`), 'delete report');
      refused(await c.get('/api/erp/bi/summary'), 'bi has no summary', [404]);
      ok(Array.isArray(must(await c.get('/api/finance/audit?limit=5'), 'finance audit')), 'audit list');
      if (S.ca) refused(await S.ca.get('/api/finance/audit'), 'audit for a user without the privilege', [403]);
      return ov.length + ' modules in the overview, ' + ins.length + ' insights';
    });

    await u.step('ADM-17', 'Billing: quote = active users x unit price, branch lines add up, invoices list answers; counts match the organisation', async () => {
      const b = must(await c.get('/api/billing/summary'), 'billing summary'); const act = (await users()).filter(x => x.isActive).length;
      eq(b.users, act, 'billed users = active users'); eq(b.estimate, b.users * b.unitPrice, 'estimate = users x price'); eq(b.lines.reduce((s, l) => s + l.amount, 0), b.estimate, 'lines add up'); eq(b.lines.reduce((s, l) => s + l.users, 0), b.users, 'users in lines');
      ok(b.currency === 'USD' && b.sarPerUsd > 0, 'currency'); const inv = must(await c.get('/api/billing/invoices'), 'invoices'); ok(Array.isArray(inv), 'invoice list');
      const t = must(await c.get('/api/org'), 'org').tenant; eq(t.users, (await users()).length, 'org user count = admin list');
      return `${b.users} users x ${b.unitPrice} = ${b.estimate} ${b.currency}; ${inv.length} invoices`;
    });

    await u.step('ADM-18', 'Clean up: temporary users and flow removed so the workspace is as before', async () => {
      for (const n of [S.ua, S.ub]) { const x = await byName(n); if (x) must(await c.del(`/api/users/admin/${x.id}`), 'delete ' + n); }
      if (S.def) must(await c.del(`/api/definitions/${S.def.id}`), 'delete flow');
      for (const role of [ROLE, ROLE + '-c']) { const d = await rbac(); if (d.roles.some(r => r.role === role)) must(await c.del(`/api/admin/rbac/roles/${role}`), 'delete role'); }
      ok(!(await byName(S.ua)) && !(await byName(S.ub)), 'temporary users gone');
      refused(await loginRaw(S.ua, NEWPW), 'deleted user sign-in', [400, 401, 403]);
      return 'users, flow, roles removed';
    });
  }
};
