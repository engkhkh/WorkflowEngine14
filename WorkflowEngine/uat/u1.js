// User 1: Khalid Al-Rashid, IT and Systems Admin (document steps U1-03 .. U1-15) plus the permission / negative checks N-01 .. N-15.
// day0 / day2 / day3 / day4 are called by run.js. `final(ctx)` holds the N-checks and must be called by run.js AFTER day 5 (day5 itself does nothing).
const { BASE, Client, must, refused, eq, ok, step, manual } = require('./lib');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const arr = d => (Array.isArray(d) ? d : []);
const msgOf = r => (typeof r.data === 'string' ? r.data : (r.data && (r.data.message || r.data.title)) || r.text || '');
const need = (v, what) => { if (!v) throw new Error('depends on ' + what); return v; };

const FLOW_NAME = 'Purchase over 5,000';

/** Save a user back through the Admin API (the same call the Admin screen makes). */
async function putUser(ctx, key, patch) {
  const n = ctx.names[key];
  const body = Object.assign({ displayName: n.display, email: `${key}.${ctx.run}@example.com`, role: n.role, isActive: true, permissions: ctx.perms[key], branches: null }, patch);
  return ctx.U.khalid.put('/api/users/admin/' + need(ctx['id_' + key], 'U1-04 (user ' + key + ' created)'), body);
}
const getModules = async kh => must(await kh.get('/api/org/modules'), 'GET /api/org/modules');
const putModules = async (kh, enabled) => must(await kh.put('/api/org/modules', { enabled }), 'PUT /api/org/modules');
const hasHos = list => (list || []).some(p => String(p).startsWith('hos.'));

// ---------------------------------------------------------------------------------------------------------------------------- Day 0
async function day0(ctx) {
  const kh = ctx.U.khalid;
  if (!kh || !kh.token) { await step('U1-03', 'Module switches', async () => { throw new Error('Khalid is not signed in (U1-01 failed)'); }); return; }

  await step('U1-03', 'Setup > Modules: all 22 on; Hospital off -> refused; back on -> works', async () => {
    const m = await getModules(kh);
    eq(m.all.length, 22, 'number of modules');
    eq(m.enabled.length, 22, 'modules enabled at the start');
    const all = m.all;
    try {
      await putModules(kh, all.filter(k => k !== 'hospital'));
      const off = await getModules(kh);
      ok(!off.enabled.includes('hospital') && off.enabled.length === 21, 'hospital should be switched off (21 modules on), got ' + off.enabled.length);
      refused(await kh.get('/api/hospital/records/patient'), 'hospital while off (Khalid)');
      const me = must(await kh.get('/api/users/me'), 'users/me');
      ok(!hasHos(me.effectivePermissions), 'Khalid still has hos.* privileges while the module is off (sidebar link would stay)');
    } finally {
      await putModules(kh, all);
    }
    const on = await getModules(kh);
    eq(on.enabled.length, 22, 'modules enabled after switching back');
    must(await kh.get('/api/hospital/records/patient'), 'hospital after switching on');
    const me2 = must(await kh.get('/api/users/me'), 'users/me');
    ok(hasHos(me2.effectivePermissions), 'hos.* privileges did not come back');
    return 'hospital off: 21 modules, /api/hospital refused; on again: 22, works';
  });

  await step('U1-04c', 'Invite flow: invited user has no password, link is accepted, then signs in (extra to U1-04)', async () => {
    const un = 'invitee.' + ctx.run;
    const c = must(await kh.post('/api/users/admin', { username: un, displayName: 'Invited Tester', email: un + '@example.com', role: 'employee', invite: true, isActive: true }), 'create invited user');
    ok(c.inviteToken, 'no invitation token returned');
    ok(c.invitePending === true, 'invitePending should be true');
    const before = await new Client('x').post('/api/auth/login', { username: un, password: ctx.password });
    refused(before, 'login before accepting the invitation');
    const info = must(await new Client('x').get('/api/auth/invite?token=' + encodeURIComponent(c.inviteToken)), 'invite info');
    eq(info.username, un, 'invite username');
    const acc = must(await new Client('x').post('/api/auth/accept-invite', { token: c.inviteToken, password: ctx.password }), 'accept-invite');
    ok(acc.token, 'accept-invite returned no token');
    const l = new Client('inv'); await l.login(un, ctx.password);
    refused(await new Client('x').post('/api/auth/accept-invite', { token: c.inviteToken, password: ctx.password }), 'invite used twice');
    must(await kh.del('/api/users/admin/' + c.id), 'delete invited tester');
    return 'invite -> accept -> login -> deleted';
  });

  await step('U1-04d', 'Starter plan shows 25 users / 1 company / 10 branches (extra)', async () => {
    const o = must(await kh.get('/api/org'), 'org');
    const t = o.tenant;
    eq(t.plan, 'starter', 'plan'); eq(t.maxUsers, 25, 'max users'); eq(t.maxCompanies, 1, 'max companies'); eq(t.maxBranches, 10, 'max branches');
    ok(t.users >= 5, 'expected at least the five UAT users, got ' + t.users);
    return `users ${t.users}/${t.maxUsers}, branches ${t.branches}/${t.maxBranches}`;
  });

  await step('U1-05', 'Privileges per user are as listed; a privilege change applies to a signed-in user without re-login', async () => {
    const list = must(await kh.get('/api/users/admin'), 'user list');
    const probe = { noura: 'proc.po.approve', faisal: 'proc.receive', reem: 'pos.sell', sara: 'hos.clinical.manage' };
    for (const k of Object.keys(probe)) {
      const u = list.find(x => x.username === ctx.users[k]);
      ok(u, `user ${k} missing from the Admin list`);
      ok(u.effectivePermissions.includes(probe[k]), `${k} lacks ${probe[k]}`);
      eq(u.effectivePermissions.length, (ctx.perms[k] || []).length, `${k}: number of privileges`);
    }
    // Noura stays signed in (same token) while Khalid grants and withdraws two hospital privileges.
    const noura = need(ctx.U.noura, 'U1-04b (Noura signed in)');
    refused(await noura.get('/api/hospital/records/patient'), 'Noura hospital before the grant');
    must(await putUser(ctx, 'noura', { permissions: [...ctx.perms.noura, 'hos.view', 'hos.patients.view'] }), 'grant');
    try {
      must(await noura.get('/api/hospital/records/patient'), 'Noura hospital after the grant (same token)');
      const me = must(await noura.get('/api/users/me'), 'Noura users/me');
      ok(me.effectivePermissions.includes('hos.patients.view'), 'users/me does not show the new privilege (menu would not change)');
    } finally {
      must(await putUser(ctx, 'noura', {}), 'withdraw');
    }
    refused(await noura.get('/api/hospital/records/patient'), 'Noura hospital after withdrawing (same token)');
    return 'granted and withdrawn on the same token, effective on the next request';
  });

  await step('U1-06', 'Workflow designer: "Purchase over 5,000" Requester -> Procurement approval -> Finance approval, published', async () => {
    const f = (key, label, type, required) => ({ key, label, type, required: !!required });
    const nodes = [
      { id: 'n-start', type: 'Start', name: 'Start', x: 40, y: 200 },
      { id: 'n-req', type: 'FormTask', name: 'Requester', x: 220, y: 200, assignee: '{{initiator}}', priority: 'Normal', description: 'Describe the purchase and enter the amount.',
        form: { title: 'Purchase request', fields: [f('amount', 'Amount (SAR, incl. VAT)', 'Number', true), f('description', 'What is being bought', 'TextArea', true), f('supplier', 'Supplier', 'Text')] } },
      { id: 'n-proc', type: 'ApprovalTask', name: 'Procurement approval', x: 440, y: 200, assignee: 'procurement', priority: 'High', description: 'Check supplier, quantities and price.',
        form: { title: 'Procurement approval', fields: [f('procComment', 'Procurement comment', 'TextArea')] } },
      { id: 'n-fin', type: 'ApprovalTask', name: 'Finance approval', x: 660, y: 200, assignee: 'finance', priority: 'High', description: 'Check budget and approve the spend.',
        form: { title: 'Finance approval', fields: [f('finComment', 'Finance comment', 'TextArea')] } },
      { id: 'n-ok', type: 'End', name: 'Approved', x: 880, y: 120 },
      { id: 'n-no', type: 'End', name: 'Rejected', x: 660, y: 380 },
    ];
    const e = (id, s, t, label) => ({ id, sourceNodeId: s, targetNodeId: t, label });
    const edges = [e('e1', 'n-start', 'n-req', 'Default'), e('e2', 'n-req', 'n-proc', 'Submit'), e('e3', 'n-proc', 'n-fin', 'Approve'), e('e4', 'n-proc', 'n-no', 'Reject'), e('e5', 'n-fin', 'n-ok', 'Approve'), e('e6', 'n-fin', 'n-no', 'Reject')];
    const def = must(await kh.post('/api/definitions', { name: FLOW_NAME, description: 'Any purchase above SAR 5,000: requester, procurement approval, finance approval.', nodes, edges }), 'create flow');
    eq(arr(def.nodes).length, 6, 'saved nodes'); eq(arr(def.edges).length, 6, 'saved edges');
    ok(def.isPublished === false, 'a new flow must start as a draft');
    // a flow without an End node must be refused at publish
    const bad = must(await kh.post('/api/definitions', { name: 'UAT invalid flow', nodes: [{ id: 's', type: 'Start', name: 'Start' }], edges: [] }), 'create invalid flow');
    const badPub = refused(await kh.post(`/api/definitions/${bad.id}/publish`), 'publish without End node');
    ok(/End/i.test(msgOf(badPub)), 'unexpected publish message: ' + msgOf(badPub));
    must(await kh.del('/api/definitions/' + bad.id), 'delete invalid flow');
    const pub = must(await kh.post(`/api/definitions/${def.id}/publish`), 'publish');
    ok(pub.isPublished === true, 'flow not published');
    ctx.S.flow = { id: def.id, name: FLOW_NAME };
    const asRequester = arr(must(await need(ctx.U.faisal, 'U1-04b').get('/api/definitions'), 'definitions as requester'));
    ok(asRequester.some(d => d.id === def.id && d.isPublished), 'published flow is not visible to a requester (Faisal)');
    return 'flow ' + def.id + ' published, visible to requesters';
  });

  await step('U1-07', 'BPM > Processes and Monitor: process listed, zero running instances on Day 0', async () => {
    const flow = need(ctx.S.flow, 'U1-06');
    const p = must(await kh.post('/api/erp/bpm/records/process', { data: { name: FLOW_NAME, owner: ctx.users.khalid, slaHours: 48, workflowId: flow.id, description: 'Procurement then finance approval above SAR 5,000' } }), 'create BPM process');
    ok(p.code, 'process got no code');
    const list = arr(must(await kh.get('/api/erp/bpm/records/process'), 'BPM processes'));
    ok(list.some(x => x.data && x.data.name === FLOW_NAME), 'BPM process list does not show the new process');
    const sum = must(await kh.get('/api/erp/bpm/summary'), 'BPM summary');
    ok(sum.kpis.find(k => k.k === 'processes').v >= 1, 'BPM KPI "processes" should be at least 1');
    const inst = arr(must(await kh.get('/api/instances'), 'instances')).filter(i => i.definitionId === flow.id);
    eq(inst.length, 0, 'running instances of the flow on Day 0');
    ctx.S.bpm = { id: p.id, code: p.code };
    return 'process ' + p.code + ', 0 instances';
  });

  await step('U1-08', 'Integration: key erp-sync shown once, webhook active and tested, key works on the read API', async () => {
    const k = must(await kh.post('/api/erp/int/apikeys', { name: 'erp-sync', scopes: ['proc:*', 'crm:*', 'mfg:*', 'prj:*', 'wh:*', 'scm:*'] }), 'create key');
    ok(/^wk_[0-9a-f]{40}$/.test(k.key), 'key format unexpected: ' + k.key);
    eq(k.prefix, k.key.slice(0, 11), 'key prefix');
    const keys = arr(must(await kh.get('/api/erp/int/records/apikey'), 'list keys'));
    const mine = keys.find(x => x.id === k.id);
    ok(mine, 'key not listed');
    ok(!JSON.stringify(keys).includes(k.key), 'the full key is visible in the key list (must be masked after creation)');
    eq(mine.status, 'Active', 'key status');

    const hook = must(await kh.post('/api/erp/int/records/webhook', { data: { name: 'Approved documents', url: 'https://example.com/hook', events: '*', secret: 'uat-secret' } }), 'create webhook');
    eq(hook.status, 'Active', 'webhook status');
    const t = must(await kh.post(`/api/erp/int/webhooks/${hook.id}/test`), 'test webhook');
    ok(typeof t.ok === 'boolean' && 'status' in t, 'webhook test answer has no ok/status');
    const logs = arr(must(await kh.get('/api/erp/int/records/log'), 'integration log'));
    ok(logs.some(l => l.data && l.data.event === 'ping' && l.ref === hook.code), 'the test delivery was not logged');

    const api = async (path, key) => { const r = await fetch(BASE + path, { headers: key ? { 'X-Api-Key': key } : {} }); return { status: r.status, text: await r.text() }; };
    const good = await api('/api/integration/v1/proc/po', k.key);
    eq(good.status, 200, 'read API with the key');
    ok(Array.isArray(JSON.parse(good.text)), 'read API did not return a list');
    eq((await api('/api/integration/v1/proc/po', null)).status, 401, 'read API without key');
    eq((await api('/api/integration/v1/proc/po', 'wk_' + '0'.repeat(40))).status, 401, 'read API with a wrong key');
    eq((await api('/api/integration/v1/ast/asset', k.key)).status, 403, 'read API outside the key scope');
    const after = arr(must(await kh.get('/api/erp/int/records/apikey'), 'list keys')).find(x => x.id === k.id);
    ok(after.data && after.data.lastUsed, 'lastUsed was not recorded after using the key');
    ctx.S.int = { keyId: k.id, prefix: k.prefix, key: k.key, hookId: hook.id, hookCode: hook.code };
    return `key ${k.prefix}... masked after creation, scope enforced; webhook ${hook.code} active, test delivery ${t.ok ? 'ok' : 'failed (HTTP ' + t.status + ': ' + t.message + ')'} logged`;
  });
  manual('U1-08b', 'Integration > Docs page lists the endpoints', 'Browser-only: open Integration > Docs and check it lists /api/integration/v1/{module}/{kind} and the X-Api-Key header.');

  await step('U1-09', 'Calendar > Settings saved (Jitsi public server, working hours)', async () => {
    const r = must(await kh.put('/api/calendar/settings', { jitsiDomain: 'meet.jit.si', workStart: '09:00', workEnd: '17:00', defaultDuration: 30, reminderMinutes: 10 }), 'save settings');
    eq(r.jitsiDomain, 'meet.jit.si', 'jitsiDomain');
    const g = must(await kh.get('/api/calendar/settings'), 'read settings');
    eq(g.jitsiDomain, 'meet.jit.si', 'jitsiDomain after reload'); eq(g.workStart, '09:00', 'workStart'); eq(g.workEnd, '17:00', 'workEnd');
    const sara = must(await need(ctx.U.sara, 'U1-04b').get('/api/calendar/settings'), 'Sara reads settings');
    eq(sara.jitsiDomain, 'meet.jit.si', 'Sara sees the same video server');
    return 'saved; note: default duration 30 / reminder 10 are not stored by the API (see notes)';
  });

  manual('U1-10', 'Assistant: rename Dashboard to Home, reset names, works offline', 'Browser-only: the assistant is a client-side feature (sidebar names and offline replies).');
}

// ---------------------------------------------------------------------------------------------------------------------------- Day 1
async function day1() { /* nothing for Khalid on Day 1 */ }

// ---------------------------------------------------------------------------------------------------------------------------- Day 2
async function day2(ctx) {
  const kh = ctx.U.khalid;
  await step('U1-11', 'Website: site Al-Noor Supplies, pages Home + Products, checkout form, published with a public address', async () => {
    const design = { pages: [{ id: 'home', title: 'Home', blocks: [{ type: 'hero', text: 'Al-Noor Supplies - medical consumables' }] }, { id: 'products', title: 'Products', blocks: [{ type: 'shop' }] }], checkout: { enabled: true } };
    const s = must(await kh.post('/api/website/sites', { name: 'Al-Noor Supplies', design, currency: 'SAR' }), 'create site');
    ok(s.slug && s.published === false, 'new site should be an unpublished draft with a slug');
    const saved = must(await kh.get('/api/website/sites/' + s.id), 'read site');
    eq(arr(saved.design.pages).length, 2, 'saved pages');
    const pre = await fetch(BASE + '/s/' + s.slug);
    ok(!(pre.status === 200 && (await pre.text()).includes('Al-Noor Supplies')), 'public page is served before publishing');
    const products = [{ sku: 'GLV-NIT-M', name: 'Nitrile gloves M, box of 100', price: 26 }, { sku: 'SM-3PLY', name: 'Surgical mask 3-ply, box of 50', price: 15 }];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Al-Noor Supplies</title></head><body>
<section id="home"><h1>Home</h1><p>Al-Noor Supplies</p></section>
<section id="products"><h2>Products</h2><ul>${products.map(p => `<li>${p.name} - SAR ${p.price}</li>`).join('')}</ul></section>
<form id="checkout" method="post"><input name="name"><input name="phone"><select name="sku"><option>GLV-NIT-M</option></select><input name="qty"><button>Order</button></form>
</body></html>`;
    const p = must(await kh.post(`/api/website/sites/${s.id}/publish`, { html, products, currency: 'SAR' }), 'publish');
    ok(p.published === true, 'site not published');
    const page = await fetch(BASE + '/s/' + s.slug);
    eq(page.status, 200, 'public page after publishing');
    const body = await page.text();
    ok(body.includes('Home') && body.includes('Products') && body.includes('<form'), 'public page misses Home, Products or the checkout form');
    ok(/sandbox/.test(page.headers.get('content-security-policy') || ''), 'public page is not served with the sandbox CSP');
    ctx.S.web = { siteId: s.id, slug: s.slug, address: BASE + '/s/' + s.slug, products };
    return 'public address ' + ctx.S.web.address;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------- Day 3
async function day3(ctx) {
  const kh = ctx.U.khalid;

  await step('U1-11b', 'Website (Day 3): visitor Bayan Dental Center orders 5 glove boxes at 26.00 from the public site', async () => {
    const w = need(ctx.S.web, 'U1-11 (published site)');
    const pub = new Client('public');
    const r = must(await pub.post(`/api/public/sites/${w.slug}/orders`, { name: 'Bayan Dental Center', phone: '0500000000', email: 'orders@bayan-dental.example.com', address: 'Dammam', note: 'UAT order', lines: [{ sku: 'GLV-NIT-M', qty: 5 }] }), 'public order');
    ok(/^WO-\d{8}-\d{4}$/.test(r.number), 'order number format: ' + r.number);
    eq(r.total, 130, 'order total (5 x 26.00)');
    refused(await pub.post(`/api/public/sites/${w.slug}/orders`, { name: 'Bad', phone: '0500000000', lines: [{ sku: 'NOPE', qty: 1 }] }), 'order with an unknown product');
    refused(await pub.post(`/api/public/sites/${w.slug}/orders`, { name: 'X', lines: [{ sku: 'GLV-NIT-M', qty: 1 }] }), 'order without name/contact');
    const subs = arr(must(await kh.get('/api/website/submissions?siteId=' + w.siteId + '&kind=order'), 'submissions'));
    const mine = subs.find(s => s.number === r.number);
    ok(mine, 'the order is not in Website > Orders'); eq(mine.status, 'new', 'order status'); eq(mine.total, 130, 'stored total');
    ctx.S.web.order = { number: r.number, total: r.total, id: mine.id };
    return `order ${r.number}, total ${r.total}, status new (Reem processes it)`;
  });

  await step('U1-12', 'Integration > Logs: webhook deliveries with status and time', async () => {
    const logs = arr(must(await kh.get('/api/erp/int/records/log'), 'integration log'));
    ok(logs.length > 0, 'no webhook deliveries at all');
    for (const l of logs) { ok(['Success', 'Failed'].includes(l.status), 'log row without status: ' + l.status); ok(l.createdAt, 'log row without time'); }
    const events = {};
    for (const l of logs) { const e = (l.data && l.data.event) || '?'; events[e] = (events[e] || 0) + 1; }
    const poKey = Object.keys(ctx.S).find(k => /^po/i.test(k));
    if (poKey) ok(events['po.received'] > 0, `a purchase order was saved in ctx.S.${poKey} but no po.received delivery exists (events: ${JSON.stringify(events)})`);
    const sum = must(await kh.get('/api/erp/int/summary'), 'integration summary');
    const dl = sum.kpis.find(k => k.k === 'deliveries').v;
    eq(dl, logs.length, 'deliveries KPI vs log rows');
    return 'deliveries by event: ' + JSON.stringify(events);
  });

  await step('U1-13', 'BI: overview and insights answer; branch sales equal POS takings; report "Branch sales" saved and reopens', async () => {
    const ov = arr(must(await kh.get('/api/erp/bi/overview'), 'BI overview'));
    ok(ov.length > 0 && ov.every(m => m.module && Array.isArray(m.kpis)), 'BI overview is empty or malformed');
    const ins = must(await kh.get('/api/erp/bi/insights'), 'BI insights');
    ok(Array.isArray(ins), 'insights is not a list');
    const sum = must(await kh.get('/api/pos/summary?days=90'), 'POS summary');
    const sales = arr(must(await kh.get('/api/pos/records/sale?take=5000'), 'POS sales'));
    const by = {};
    for (const s of sales) { if (s.status === 'Voided' || !s.data || s.data.type !== 'Sale') continue; const b = s.branch || ''; by[b] = (by[b] || 0) + Number(s.data.total || 0); }
    for (const row of arr(sum.byBranch)) eq(row.value, by[row.name] || 0, `POS summary vs sales documents for branch '${row.name}'`, 0.01);
    const snapshot = arr(sum.byBranch).map(r => ({ branch: r.name, sales: r.value }));
    const rep = must(await kh.post('/api/erp/bi/records/report', { data: { name: 'Branch sales', source: 'pos', measure: 'sales', groupBy: 'branch', period: 'month', snapshot } }), 'save report');
    const again = arr(must(await kh.get('/api/erp/bi/records/report'), 'reports')).find(r => r.id === rep.id);
    ok(again && again.data.name === 'Branch sales', 'saved report does not reopen');
    eq(arr(again.data.snapshot).length, snapshot.length, 'reopened snapshot rows');
    ctx.S.biReport = { id: rep.id, code: rep.code, byBranch: snapshot };
    return 'sales by branch ' + JSON.stringify(snapshot) + ' (doc: Dammam retail day 133.63)';
  });
}

// ---------------------------------------------------------------------------------------------------------------------------- Day 4
async function day4(ctx) {
  const kh = ctx.U.khalid;

  await step('U1-14', 'Workflow > Instances: every "Purchase over 5,000" shows its approval path and who approved', async () => {
    const flow = need(ctx.S.flow, 'U1-06');
    const faisal = need(ctx.U.faisal, 'U1-04b'), noura = need(ctx.U.noura, 'U1-04b');
    const task = async (c, instanceId, nodeName) => {
      const t = arr(must(await c.get('/api/tasks'), c.name + ' tasks')).find(x => x.instanceId === instanceId && x.nodeName === nodeName);
      ok(t, `${c.name} has no pending task '${nodeName}' for instance ${instanceId}`);
      return t;
    };
    const start = async (amount, text) => {
      const inst = must(await kh.post('/api/instances/start', { definitionId: flow.id, initialData: { amount, description: text } }), 'start instance');
      const t = await task(kh, inst.id, 'Requester');
      must(await kh.post(`/api/tasks/${t.id}/complete`, { decision: 'Submit', formData: { amount, description: text, supplier: 'Gulf Medical Supplies' }, comment: 'Please approve' }), 'requester submit');
      return inst.id;
    };
    // A: full path. B: stops at Finance approval (used by N-06).
    const a = await start(47380, 'Purchase order 47,380.00 incl. VAT');
    const pa = await task(faisal, a, 'Procurement approval');
    must(await faisal.post(`/api/tasks/${pa.id}/complete`, { decision: 'Approve', formData: { procComment: 'Prices checked' }, comment: 'Procurement OK' }), 'procurement approves');
    const fa = await task(noura, a, 'Finance approval');
    must(await noura.post(`/api/tasks/${fa.id}/complete`, { decision: 'Approve', formData: { finComment: 'Within budget' }, comment: 'Finance OK' }), 'finance approves');
    const A = must(await kh.get('/api/instances/' + a), 'instance A');
    eq(A.status, 'Completed', 'instance A status');
    const approvals = arr(A.history).filter(h => h.action === 'Approve');
    ok(approvals.some(h => h.nodeName === 'Procurement approval' && h.actor === ctx.users.faisal), 'history misses the procurement approval by Faisal');
    ok(approvals.some(h => h.nodeName === 'Finance approval' && h.actor === ctx.users.noura), 'history misses the finance approval by Noura');
    ok(arr(A.history).some(h => h.action === 'Submit' && h.actor === ctx.users.khalid), 'history misses the requester submit');
    ok(arr(must(await kh.get(`/api/instances/${a}/activity-log`), 'activity log')).length >= 3, 'activity log is too short');

    const b = await start(12000, 'Purchase order 12,000.00 incl. VAT');
    const pb = await task(faisal, b, 'Procurement approval');
    must(await faisal.post(`/api/tasks/${pb.id}/complete`, { decision: 'Approve', comment: 'Procurement OK' }), 'procurement approves B');
    const fb = await task(noura, b, 'Finance approval');
    ctx.S.flowPending = { instanceId: b, financeTaskId: fb.id };

    const all = arr(must(await kh.get('/api/instances'), 'instances')).filter(i => i.definitionId === flow.id);
    eq(all.length, 2, 'instances of the flow');
    for (const i of all) ok(arr(i.history).some(h => h.action === 'Approve' && h.actor), 'instance ' + i.id + ' shows no approver');
    return `A completed (Submit khalid, Approve ${ctx.users.faisal}, Approve ${ctx.users.noura}); B waits for finance (task ${fb.id})`;
  });

}

async function day5(ctx) {
  // U1-15 runs here (not on Day 4): Reem creates the Visitors module on Day 4 and Khalid goes first within a day
  const kh = ctx.U.khalid, reem = ctx.U.reem;
  await step('U1-15', 'Custom modules: Reem\'s Visitors module is there with Badge number required; Khalid adds a field and Reem sees it', async () => {
    const mods = arr(must(await kh.get('/api/custom/modules'), 'custom modules'));
    const m = mods.find(x => x.key === 'visitors') || mods.find(x => /visitor/i.test((x.def && x.def.title) || ''));
    need(m, 'U4 (Reem creates the Visitors module; Reem needs cus.design, see notes)');
    const fields = arr(m.def.fields);
    const badge = fields.find(f => /badge/i.test(f.label));
    ok(badge, 'the Visitors module has no Badge number field (fields: ' + fields.map(f => f.label).join(', ') + ')');
    ok(badge.required === true, 'Badge number is not required');
    const keep = fields.map(f => ({ key: f.key, label: f.label, labelAr: f.labelAr, type: f.type, required: !!f.required, options: f.options }));
    const body = { title: m.def.title, titleAr: m.def.titleAr, icon: m.def.icon, color: m.def.color, fields: [...keep, { label: 'Parking slot', type: 'text', required: false }] };
    const u = must(await kh.put('/api/custom/modules/' + m.key, body), 'add field');
    eq(arr(u.def.fields).length, fields.length + 1, 'fields after adding one');
    const reem = need(ctx.U.reem, 'U1-04b');
    const rm = arr(must(await reem.get('/api/custom/modules'), 'Reem custom modules')).find(x => x.key === m.key);
    ok(rm && arr(rm.def.fields).some(f => f.label === 'Parking slot'), 'Reem does not see the new field');
    const recs = arr(must(await reem.get('/api/custom/records/' + m.key), 'Reem visitors records'));
    ctx.S.visitorsModule = { key: m.key, fieldsBefore: fields.length, records: recs.length };
    return `module ${m.key}: ${fields.length} fields (+Parking slot), ${recs.length} visitor records; Reem sees the new field`;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------- N-checks
async function final(ctx) {
  const kh = ctx.U.khalid, reem = ctx.U.reem, faisal = ctx.U.faisal, sara = ctx.U.sara, noura = ctx.U.noura;
  console.log(' [u1 permission and negative checks]');

  await step('N-01', 'Reem cannot reach Finance (journals, invoices, summary, posting)', async () => {
    refused(await reem.get('/api/finance/summary'), 'finance summary');
    refused(await reem.get('/api/finance/records/journal'), 'journals');
    refused(await reem.get('/api/finance/records/apinvoice'), 'supplier invoices');
    refused(await reem.get('/api/finance/records/banktxn'), 'bank transactions');
    refused(await reem.post('/api/finance/records/journal', { data: { date: ctx.today, lines: [] } }), 'creating a journal');
    const me = must(await reem.get('/api/users/me'), 'users/me');
    ok(!me.effectivePermissions.some(p => /^finance\.(gl|ap|bank|reports|setup)/.test(p)), 'Reem has finance GL/AP/bank privileges (sidebar would show Finance)');
    return 'all finance endpoints refused (the redirect for /finance in the address bar is a browser check)';
  });

  await step('N-02', 'Reem cannot see HR employees or other people\'s pay', async () => {
    refused(await reem.get('/api/hr/employees'), 'HR employees');
    refused(await reem.get('/api/erp/pay/records/run'), 'payroll runs');
    const ps = await reem.get('/api/erp/pay/records/payslip');
    if (ps.ok) {
      const slips = arr(ps.data);
      ok(slips.every(p => p.ref === ctx.users.reem), 'Reem can list payslips of other people: ' + slips.filter(p => p.ref !== ctx.users.reem).map(p => p.ref).join(','));
      return `employee list and payroll runs refused; payslip list shows only her own (${slips.length})`;
    }
    refused(ps, 'payslips');
    return 'employee list, payroll runs and payslips all refused for Reem';
  });

  await step('N-03', 'Faisal cannot open the hospital (no patient data from any hospital endpoint)', async () => {
    for (const k of ['patient', 'visit', 'prescription', 'labrequest', 'invoice', 'appointment', 'admission']) refused(await faisal.get('/api/hospital/records/' + k), 'hospital ' + k);
    refused(await faisal.get('/api/hospital/patients/MRN-000001/file'), 'patient file');
    return '7 hospital lists and the patient file refused';
  });

  await step('N-04', 'Sara cannot use the POS terminal', async () => {
    refused(await sara.post('/api/pos/shifts/open', { company: ctx.company, branch: ctx.branch.DMM, openingCash: 0 }), 'open shift');
    refused(await sara.post('/api/pos/sales/checkout', { company: ctx.company, branch: ctx.branch.DMM, lines: [{ sku: 'SM-3PLY', qty: 1 }], payments: [{ method: 'cash', amount: 100 }] }), 'checkout');
    refused(await sara.get('/api/pos/records/sale'), 'sales list');
    refused(await sara.get('/api/pos/summary'), 'POS summary');
    return 'shift, checkout, sales and summary refused';
  });

  await step('N-05', 'Noura cannot use the Workflow designer; Khalid can', async () => {
    refused(await noura.post('/api/definitions', { name: 'Noura should not create this', nodes: [], edges: [] }), 'create flow as Noura');
    const flow = need(ctx.S.flow, 'U1-06');
    refused(await noura.put('/api/definitions/' + flow.id, { name: 'hacked', nodes: [], edges: [] }), 'edit flow as Noura');
    refused(await noura.post(`/api/definitions/${flow.id}/publish`), 'publish as Noura');
    refused(await noura.del('/api/definitions/' + flow.id), 'delete as Noura');
    const mine = arr(must(await kh.get('/api/definitions'), 'Khalid definitions')).find(d => d.id === flow.id);
    ok(mine && mine.name === FLOW_NAME && arr(mine.nodes).length === 6, 'the flow was changed or lost');
    const t = must(await kh.post('/api/definitions', { name: 'Khalid scratch flow', nodes: [], edges: [] }), 'Khalid can create');
    must(await kh.del('/api/definitions/' + t.id), 'cleanup');
    return 'Noura refused on create/edit/publish/delete; Khalid can create';
  });

  await step('N-06', 'Faisal cannot approve his own order and cannot act on the finance approval task', async () => {
    const note = [];
    // (a) purchase order approval: separate approver required
    const po = must(await faisal.post('/api/erp/proc/records/po', { branch: ctx.branch.JED, data: { vendor: 'UAT-SELF-APPROVE', date: ctx.today, lines: [{ sku: 'SM-3PLY', qty: 1, price: 1 }] } }), 'Faisal creates a PO');
    try {
      const r = refused(await faisal.post(`/api/erp/proc/pos/${po.id}/approve`), 'Faisal approving his own PO');
      ok(/somebody else/i.test(msgOf(r)), 'unexpected message: ' + msgOf(r));
      note.push('self-approval of PO refused ("' + msgOf(r) + '")');
    } finally {
      await faisal.post(`/api/erp/proc/pos/${po.id}/cancel`);
    }
    // (b) workflow: the finance approval task is only on Noura's list (instance B from U1-14)
    const p = ctx.S.flowPending;
    if (p) {
      ok(!arr(must(await faisal.get('/api/tasks'), 'Faisal tasks')).some(t => t.id === p.financeTaskId), 'the finance task is on Faisal\'s list');
      refused(await faisal.post(`/api/tasks/${p.financeTaskId}/complete`, { decision: 'Approve' }), 'Faisal completing the finance task');
      ok(arr(must(await noura.get('/api/tasks'), 'Noura tasks')).some(t => t.id === p.financeTaskId), 'the finance task is not on Noura\'s list');
      must(await noura.post(`/api/tasks/${p.financeTaskId}/complete`, { decision: 'Approve', comment: 'Finance OK' }), 'Noura approves instance B');
      note.push('finance task only completable by Noura');
    } else note.push('workflow part skipped (U1-14 did not leave a pending instance)');
    return note.join('; ');
  });

  await step('N-07', 'Hospital switched off: Sara\'s hospital pages are refused although her privileges are unchanged; on again restores them', async () => {
    const m = await getModules(kh);
    const before = must(await sara.get('/api/hospital/records/patient'), 'Sara hospital before');
    const sid = need(ctx.id_sara, 'U1-04');
    const storedPerms = async () => arr(must(await kh.get('/api/users/admin'), 'admin list')).find(u => u.id === sid).permissions;
    const p0 = await storedPerms();
    ok(hasHos(p0), 'Sara has no stored hospital privileges to begin with');
    try {
      await putModules(kh, m.all.filter(k => k !== 'hospital'));
      refused(await sara.get('/api/hospital/records/patient'), 'Sara hospital while off');
      refused(await sara.get('/api/hospital/records/appointment'), 'Sara appointments while off');
      const me = must(await sara.get('/api/users/me'), 'Sara users/me');
      ok(!hasHos(me.effectivePermissions), 'Sara still has effective hos.* privileges while the module is off');
      eq((await storedPerms()).length, p0.length, 'Sara\'s stored privileges while the module is off');
    } finally {
      await putModules(kh, m.all);
    }
    const after = must(await sara.get('/api/hospital/records/patient'), 'Sara hospital after switching on');
    eq(arr(after).length, arr(before).length, 'patients visible before/after');
    return `refused while off (stored privileges unchanged: ${p0.length}), restored when on`;
  });

  await step('N-08', 'Khalid deactivates Reem while she is signed in: next call is refused, data stays, reactivating restores access', async () => {
    const poll = async (want, label) => {   // the server caches "is this account active" for 20 s
      for (let i = 0; i < 20; i++) { const r = await reem.get('/api/users/me'); if (want(r)) return r; await sleep(2000); }
      throw new Error(label + ': still not as expected after 40 s (last HTTP ' + (await reem.get('/api/users/me')).status + ')');
    };
    must(await reem.get('/api/users/me'), 'Reem is signed in');
    const salesBefore = arr(must(await reem.get('/api/pos/records/sale?take=5000'), 'Reem sales before')).length;
    must(await putUser(ctx, 'reem', { isActive: false }), 'deactivate Reem');
    let reactivated = false;
    try {
      const r = await poll(x => x.status === 401, 'deactivation');
      eq(r.status, 401, 'Reem\'s call after deactivation');
      refused(await new Client('reem2').post('/api/auth/login', { username: ctx.users.reem, password: ctx.password }), 'Reem logging in while inactive');
      const row = arr(must(await kh.get('/api/users/admin'), 'admin list')).find(u => u.username === ctx.users.reem);
      ok(row && row.isActive === false, 'Reem is not listed as inactive');
      must(await putUser(ctx, 'reem', { isActive: true }), 'reactivate Reem'); reactivated = true;
      await poll(x => x.status === 200, 'reactivation');
    } finally {
      if (!reactivated) await putUser(ctx, 'reem', { isActive: true });
    }
    const salesAfter = arr(must(await reem.get('/api/pos/records/sale?take=5000'), 'Reem sales after')).length;
    eq(salesAfter, salesBefore, 'Reem\'s sales before/after');
    return `401 after deactivation, 200 after reactivation, her ${salesAfter} POS sales intact`;
  });

  await step('N-09', 'Wrong password gives a neutral error that does not reveal whether the username exists', async () => {
    const c = new Client('x');
    const a = await c.post('/api/auth/login', { username: ctx.users.khalid, password: 'Wrong#Pass123' });
    const b = await c.post('/api/auth/login', { username: 'nobody.' + ctx.run, password: 'Wrong#Pass123' });
    eq(a.status, 401, 'wrong password for an existing user'); eq(b.status, 401, 'unknown user');
    eq(a.text, b.text, 'error text for existing vs unknown user');
    ok(!/token/i.test(a.text), 'a token appears in the error');
    ok(!/not exist|unknown user|no such/i.test(a.text), 'the error hints at the username: ' + a.text);
    return 'both: 401 "' + a.text + '"';
  });

  await step('N-10', 'Noura closes September 2026, then a journal dated 2026-09-30 cannot be posted', async () => {
    const accs = arr(must(await noura.get('/api/finance/records/account'), 'accounts')).filter(a => a.status !== 'Inactive' && !(a.data && a.data.isHeader) && a.code);
    ok(accs.length >= 2, 'needs at least two postable accounts in the chart of accounts (Noura\'s Day 1 setup)');
    const periods = arr(must(await noura.get('/api/finance/records/period'), 'periods'));
    let per = periods.find(p => p.code === '2026-09');
    let created = false;
    if (!per) { per = must(await noura.post('/api/finance/records/period', { code: '2026-09', company: ctx.company, status: 'Open', data: { name: 'September 2026', from: '2026-09-01', to: '2026-09-30' } }), 'create period'); created = true; }
    const wasClosed = per.status === 'Closed';
    const setPeriod = status => noura.put('/api/finance/records/period/' + per.id, { code: per.code, company: per.company, status, data: per.data });
    // A journal drafted by Khalid (so segregation of duties cannot be the reason for a refusal) and posted by Noura.
    const j = must(await kh.post('/api/finance/records/journal', { company: ctx.company, status: 'Draft', data: { date: '2026-09-30', description: 'UAT closed-period test', lines: [{ account: accs[0].code, debit: 100, credit: 0 }, { account: accs[1].code, debit: 0, credit: 100 }] } }), 'draft journal');
    try {
      if (!wasClosed) must(await setPeriod('Closed'), 'close September 2026');
      const r = refused(await noura.put('/api/finance/records/journal/' + j.id, { code: j.code, company: j.company, status: 'Posted', data: j.data }), 'posting into the closed period');
      ok(/closed/i.test(msgOf(r)), 'refused, but not with a closed-period message: ' + msgOf(r));
      const still = arr(must(await noura.get('/api/finance/records/journal'), 'journals')).find(x => x.id === j.id);
      eq(still.status, 'Draft', 'journal status after the refused posting');
      return 'refused: ' + msgOf(r);
    } finally {
      if (!wasClosed) await setPeriod('Open');
      await kh.del('/api/finance/records/journal/' + j.id);
      if (created) await noura.del('/api/finance/records/period/' + per.id);
    }
  });

  await step('N-11', 'Reem sells more SM-3PLY at the Dammam terminal than the stock holds: refused, stock unchanged', async () => {
    const br = ctx.branch.DMM;
    const stockOf = async () => { const s = arr(must(await reem.get('/api/pos/records/stock?branch=' + br), 'stock')).find(x => x.branch === br && x.data && x.data.sku === 'SM-3PLY'); return s ? Number(s.data.qty) : 0; };
    const have = await stockOf();
    const qty = Math.max(100, have + 1);
    const cur = await reem.get('/api/pos/shifts/current');
    const opened = cur.data ? null : must(await reem.post('/api/pos/shifts/open', { company: ctx.company, branch: br, openingCash: 0 }), 'open shift');
    try {
      const r = await reem.post('/api/pos/sales/checkout', { company: ctx.company, branch: br, lines: [{ sku: 'SM-3PLY', qty }], payments: [{ method: 'cash', amount: qty * 100 }] });
      if (r.ok) throw new Error(`oversell accepted: sale ${r.data && r.data.code} for ${qty} with only ${have} in stock (stock is allowed to go negative)`);
      eq(r.status, 400, 'checkout status');
      ok(/not enough stock/i.test(msgOf(r)), 'refused for another reason: ' + msgOf(r));
      eq(await stockOf(), have, 'stock after the refused sale');
      return `${qty} requested, ${have} in stock: "${msgOf(r)}"`;
    } finally {
      if (opened) await reem.post(`/api/pos/shifts/${opened.id}/close`, { countedCash: 0, note: 'UAT N-11 cleanup' });
    }
  });

  await step('N-12', 'Faisal saves a purchase order with no supplier / a negative quantity: field-level errors, nothing saved', async () => {
    const list = async () => arr(must(await faisal.get('/api/erp/proc/records/po'), 'POs')).length;
    const n0 = await list();
    const post = data => faisal.post('/api/erp/proc/records/po', { branch: ctx.branch.JED, data });
    const a = refused(await post({ vendor: '', date: ctx.today, lines: [{ sku: 'SM-3PLY', qty: 10, price: 8 }] }), 'no supplier');
    ok(/supplier/i.test(msgOf(a)), 'message for the missing supplier: ' + msgOf(a));
    const b = refused(await post({ vendor: 'UAT-SUP', date: ctx.today, lines: [{ sku: 'SM-3PLY', qty: -5, price: 8 }] }), 'negative quantity');
    ok(/quantit/i.test(msgOf(b)), 'message for the negative quantity: ' + msgOf(b));
    const c = refused(await post({ vendor: 'UAT-SUP', date: ctx.today, lines: [] }), 'no lines');
    ok(/line/i.test(msgOf(c)), 'message for no lines: ' + msgOf(c));
    eq(await list(), n0, 'number of purchase orders after three refused saves');
    return `"${msgOf(a)}" / "${msgOf(b)}" / "${msgOf(c)}"; PO count unchanged (${n0})`;
  });

  manual('N-13', 'Sara switches to Arabic (right-to-left, Hijri dates); Khalid to German (no raw keys like nav.finance)', 'Browser-only: language, direction and translation keys are client features.');

  await step('N-14', 'Second workspace "Demo Co" sees none of Al-Noor\'s records, users, patients or invoices', async () => {
    const demo = new Client('demo');
    const dn = 'demo.' + ctx.run;
    const su = must(await demo.post('/api/tenants/signup', { workspaceName: 'Demo Co ' + ctx.run, displayName: 'Demo Admin', username: dn, password: ctx.password, currency: 'SAR', email: dn + '@example.com', branches: ['Main'] }), 'signup Demo Co');
    demo.token = su.token; demo.info = su; ctx.S.demo = demo;
    ok(su.tenantId && su.tenantId !== kh.info.tenantId, 'Demo Co got the same workspace id as Al-Noor');
    const users = arr(must(await demo.get('/api/users/admin'), 'demo users'));
    eq(users.length, 1, 'users in Demo Co'); eq(users[0].username, dn, 'only user');
    const org = must(await demo.get('/api/org'), 'demo org');
    eq(org.branches.length, 1, 'branches in Demo Co'); eq(org.companies.length, 1, 'companies in Demo Co');
    ok(org.tenant.id !== kh.info.tenantId, 'tenant id equals Al-Noor');

    const lists = [['/api/erp/proc/records/po', true], ['/api/erp/crm/records/lead', true], ['/api/erp/mfg/records/workorder', true], ['/api/erp/prj/records/project', true],
      ['/api/pos/records/sale', true], ['/api/pos/records/product', false], ['/api/finance/records/apinvoice', true], ['/api/finance/records/arinvoice', true], ['/api/finance/records/journal', true],
      ['/api/hospital/records/patient', true], ['/api/hospital/records/visit', true], ['/api/website/sites', true], ['/api/custom/modules', true], ['/api/hr/employees', false]];
    const seen = [];
    for (const [path, mustBeEmpty] of lists) {
      const mine = arr(must(await kh.get(path), 'Al-Noor ' + path));
      const theirs = arr(must(await demo.get(path), 'Demo ' + path));
      const ids = new Set(mine.map(x => x.id));
      ok(!theirs.some(x => ids.has(x.id)), `Demo Co sees Al-Noor records on ${path}`);
      if (mustBeEmpty) eq(theirs.length, 0, `Demo Co rows on ${path} (Al-Noor has ${mine.length})`);
      seen.push(`${path.replace('/api/', '')}:${mine.length}->0`);
    }
    // direct access by id
    const pat = arr(must(await sara.get('/api/hospital/records/patient'), 'Sara patients'))[0];
    if (pat) refused(await demo.get('/api/hospital/records/patient/' + pat.id), 'patient by id from another workspace');
    if (ctx.S.web) refused(await demo.get('/api/website/sites/' + ctx.S.web.siteId), 'site by id from another workspace');
    if (ctx.S.flow) { refused(await demo.get('/api/definitions/' + ctx.S.flow.id), 'flow by id'); ok(!arr(must(await demo.get('/api/definitions'), 'demo flows')).some(d => d.id === ctx.S.flow.id), 'Demo Co lists Al-Noor\'s flow'); }
    if (ctx.S.flowPending) refused(await demo.get('/api/instances/' + ctx.S.flowPending.instanceId), 'instance by id');
    ok(arr(must(await demo.get('/api/instances'), 'demo instances')).every(i => i.startedBy === dn), 'Demo Co sees instances started by Al-Noor users');
    refused(await demo.put('/api/users/admin/' + kh.info.id, { displayName: 'x', email: 'x@x.com', role: 'admin', isActive: false, permissions: null }), 'editing Al-Noor\'s Khalid from Demo Co');
    must(await kh.get('/api/users/me'), 'Khalid unaffected');
    return seen.join(' ');
  });

  await step('N-14b', 'Starter plan: the 26th user in a workspace is refused (limit 25)', async () => {
    const demo = need(ctx.S.demo, 'N-14 (Demo Co workspace)');
    const o = must(await demo.get('/api/org'), 'org');
    eq(o.tenant.maxUsers, 25, 'plan user limit');
    for (let n = o.tenant.users; n < 25; n++) {
      const un = `dm${ctx.run}u${n}`;
      must(await demo.post('/api/users/admin', { username: un, displayName: 'Demo ' + n, email: un + '@example.com', role: 'employee', invite: true, isActive: true }), 'create user #' + (n + 1));
    }
    const r = await demo.post('/api/users/admin', { username: `dm${ctx.run}over`, displayName: 'One too many', email: 'over@example.com', role: 'employee', invite: true, isActive: true });
    eq(r.status, 402, 'status of the 26th user');
    ok(/25/.test(msgOf(r)), 'limit message should name the limit: ' + msgOf(r));
    return '25 users created, 26th: ' + msgOf(r);
  });

  await step('N-14c', 'Starter plan: a second company is refused (limit 1)', async () => {
    const r = await kh.post('/api/org/companies', { code: 'SECOND', name: 'Second Company' });
    eq(r.status, 402, 'status of the second company');
    ok(/1 companies|plan/i.test(msgOf(r)), 'unexpected message: ' + msgOf(r));
    return msgOf(r);
  });

  manual('N-15', 'Network off: Assistant, Calendar, Prayer times and POS terminal behave as described', 'Browser-only: offline behaviour (service worker / local queue) cannot be tested through the API.');
}

module.exports = { day0, day1, day2, day3, day4, day5, final };
