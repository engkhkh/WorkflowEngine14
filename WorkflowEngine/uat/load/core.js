// Core of the 100-user test: workspaces, users, step recording, latency statistics, report.
// Profiles (load/pNN-*.js) only use u.c (the signed-in Client), u.ws, u.key and u.step - see load/README.md for the contract.
const { Client, must, refused, eq, ok, BASE } = require('../lib');

const PASSWORD = process.env.UAT_PASSWORD || 'Test@12345';
const RUN = process.env.UAT_RUN || String(Date.now()).slice(-6);
const records = [];      // every step of every user
const calls = [];        // every HTTP call: { g, method, route, status, ms }
const serverErrors = []; // HTTP 5xx and network failures

// ---- instrument every HTTP call (latency by route, 5xx list)
const origCall = Client.prototype.call;
Client.prototype.call = async function (method, path, body, opts) {
  const t0 = Date.now();
  const r = await origCall.call(this, method, path, body, opts);
  const ms = Date.now() - t0;
  const route = path.split('?')[0].replace(/\/[0-9a-f]{32}\b/gi, '/:id').replace(/\/\d+\b/g, '/:n').replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '/:id');
  calls.push({ who: this.name, method, route, status: r.status, ms });
  if (r.status >= 500 || r.status === 0) serverErrors.push({ who: this.name, method, route, status: r.status, text: String(r.text || '').slice(0, 200) });
  return r;
};

const pad = (n, w = 2) => String(n).padStart(w, '0');
const uname = (wi, n) => `l${RUN}w${wi}u${pad(n)}`;

function record(rec) { records.push(rec); }

/** The object handed to a profile's run(u). */
function makeUser(ws, n, profile, client) {
  const u = {
    c: client, ws, n, profile, g: ws.i * 100 + n,
    username: uname(ws.i, n),
    key: `W${ws.i}U${pad(n)}`,                    // unique per user: use it in codes and names
    tag: `${ws.i}${pad(n)}`,                      // short numeric tag
    state: {},                                    // per-user scratch space
    async step(id, title, fn) {
      const t0 = Date.now();
      try { const note = await fn(); record({ ws: ws.i, n, profile: profile.id, id, title, status: 'PASS', note: note || '', ms: Date.now() - t0 }); }
      catch (e) { record({ ws: ws.i, n, profile: profile.id, id, title, status: 'FAIL', note: String(e && e.message || e).slice(0, 400), ms: Date.now() - t0 }); }
    },
    /** A check that cannot be done through the API. */
    manual(id, title, why) { record({ ws: ws.i, n, profile: profile.id, id, title, status: 'MANUAL', note: why || '', ms: 0 }); },
  };
  return u;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) { const i = next++; if (i >= items.length) return; try { out[i] = await fn(items[i], i); } catch (e) { out[i] = { error: e }; } }
  });
  await Promise.all(workers); return out;
}

/** Create one workspace with its admin (user 0) and sign in. */
async function createWorkspace(i) {
  const admin = new Client(uname(i, 0));
  const r = await admin.post('/api/tenants/signup', { workspaceName: `Load Co ${RUN} W${i}`, branches: ['Riyadh', 'Jeddah', 'Dammam'], displayName: `Admin W${i}`,
    username: uname(i, 0), password: PASSWORD, currency: 'SAR', country: 'SA', email: `${uname(i, 0)}@example.com` });
  const d = must(r, `workspace ${i} signup`); admin.token = d.token; admin.info = d;
  const o = must(await admin.get('/api/org'), 'org');
  const comp = (o.companies || o.Companies || [])[0];
  const br = {}; for (const [k, n] of [['RYD', 'Riyadh'], ['JED', 'Jeddah'], ['DMM', 'Dammam']]) { const b = (o.branches || o.Branches || []).find(x => (x.name || x.Name) === n); if (b) br[k] = b.code || b.Code; }
  const cat = must(await admin.get('/api/users/permissions'), 'permission catalog');
  const all = cat.groups.flatMap(g => g.keys || g.Keys || []);
  return { i, admin, company: comp && (comp.code || comp.Code), branch: br, today: new Date().toISOString().slice(0, 10), catalog: cat, allPerms: all, roleDefaults: cat.roleDefaults, shared: {}, users: [], clients: [] };
}
const expand = (all, list) => (list || []).flatMap(p => p.endsWith('.*') ? all.filter(k => k.startsWith(p.slice(0, -1))) : [p]);

/** Create the other users of a workspace (one per profile) and sign them in. */
async function createUsers(ws, profiles, per) {
  ws.clients[0] = ws.admin; ws.profileOf = [];
  const todo = []; for (let n = 1; n < per; n++) todo.push(n);
  await pool(todo, 5, async n => {
    const p = profiles[n % profiles.length];
    const role = ws.roleDefaults[p.role] ? p.role : 'employee';
    const perms = [...new Set([...(ws.roleDefaults[role] || []), ...expand(ws.allPerms, p.perms)])];
    const r = await ws.admin.post('/api/users/admin', { username: uname(ws.i, n), displayName: `${p.id} W${ws.i}U${pad(n)}`, email: `${uname(ws.i, n)}@example.com`, role, password: PASSWORD, permissions: perms, isActive: true });
    must(r, `create user ${uname(ws.i, n)} (${p.id})`);
    const c = new Client(uname(ws.i, n)); await c.login(uname(ws.i, n), PASSWORD); ws.clients[n] = c;
  });
}

function pctl(arr, p) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }

function buildReport({ profiles, WS, PER, t0, t1, phases, extra }) {
  const lines = [];
  const cnt = s => records.filter(r => r.status === s).length;
  const secs = (t1 - t0) / 1000;
  lines.push(`# 100-user load and feature test`, '', `Run ${RUN} against ${BASE}. ${WS} workspaces x ${PER} users = ${WS * PER} users. Duration ${secs.toFixed(0)} s. ${calls.length} HTTP calls (${(calls.length / secs).toFixed(1)}/s).`, '',
    `**${cnt('PASS')} pass / ${cnt('FAIL')} fail / ${cnt('MANUAL')} manual** of ${records.length} step results. Server errors (HTTP 5xx or no answer): **${serverErrors.length}**.`, '');
  if (phases.length) { lines.push('## Phases', '', '| Phase | Seconds |', '| --- | --- |'); for (const p of phases) lines.push(`| ${p.name} | ${p.s} |`); lines.push(''); }

  // by profile / step across workspaces
  lines.push('## Results by user type and step', '', 'Each cell is passes / runs across the workspaces (every workspace runs every user type once).', '');
  const byProf = {};
  for (const r of records) { (byProf[r.profile] = byProf[r.profile] || {}); const k = r.id; const o = (byProf[r.profile][k] = byProf[r.profile][k] || { title: r.title, pass: 0, fail: 0, manual: 0, notes: new Map(), ms: [] }); if (r.status === 'PASS') o.pass++; else if (r.status === 'FAIL') { o.fail++; o.notes.set(r.note, (o.notes.get(r.note) || 0) + 1); } else o.manual++; o.ms.push(r.ms); }
  for (const p of profiles) {
    const steps = byProf[p.id] || {};
    lines.push(`### ${p.id} - ${p.title}  (modules: ${(p.modules || []).join(', ')})`, '', '| Step | Result | Title | p95 ms | First failure |', '| --- | --- | --- | --- | --- |');
    for (const [id, o] of Object.entries(steps)) {
      const res = o.manual ? `manual x${o.manual}` : `${o.pass}/${o.pass + o.fail}`;
      const first = [...o.notes.keys()][0] || '';
      lines.push(`| ${id} | ${o.fail ? '**' + res + '**' : res} | ${String(o.title).replace(/\|/g, '/')} | ${pctl(o.ms, 95)} | ${String(first).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 260)} |`);
    }
    lines.push('');
  }
  // latency by route
  const byRoute = {};
  for (const c of calls) { const k = c.method + ' ' + c.route; (byRoute[k] = byRoute[k] || []).push(c); }
  const rows = Object.entries(byRoute).map(([k, v]) => ({ k, n: v.length, p50: pctl(v.map(x => x.ms), 50), p95: pctl(v.map(x => x.ms), 95), max: Math.max(...v.map(x => x.ms)), s5: v.filter(x => x.status >= 500 || x.status === 0).length }));
  lines.push('## Slowest endpoints (p95)', '', '| Endpoint | Calls | p50 ms | p95 ms | max ms | 5xx |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of rows.sort((a, b) => b.p95 - a.p95).slice(0, 25)) lines.push(`| ${r.k} | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} | ${r.s5} |`);
  const all = calls.map(c => c.ms);
  lines.push('', `All calls: p50 ${pctl(all, 50)} ms, p95 ${pctl(all, 95)} ms, p99 ${pctl(all, 99)} ms, max ${Math.max(0, ...all)} ms.`, '');
  if (serverErrors.length) {
    lines.push('## Server errors (5xx / no answer)', '', '| Endpoint | Status | Count | Example |', '| --- | --- | --- | --- |');
    const g = {}; for (const e of serverErrors) { const k = e.method + ' ' + e.route + ' ' + e.status; (g[k] = g[k] || { n: 0, ex: e.text }).n++; }
    for (const [k, v] of Object.entries(g)) { const m = k.match(/^(.*) (\d+)$/); lines.push(`| ${m[1]} | ${m[2]} | ${v.n} | ${String(v.ex).replace(/\|/g, '/').replace(/\n/g, ' ')} |`); }
    lines.push('');
  }
  if (extra && extra.length) lines.push(...extra);
  return lines.join('\n');
}

module.exports = { PASSWORD, RUN, records, calls, serverErrors, uname, pad, makeUser, pool, createWorkspace, createUsers, expand, buildReport, record, pctl };
