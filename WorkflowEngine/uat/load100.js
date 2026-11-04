// 100+ user test: 5 workspaces x 21 users (one per user type), every user a different job, all working at the same time, covering every module.
//   node load100.js                 full run (100 users)
//   node load100.js --ws=1 one workspace only (quick check, 21 users)
//   node load100.js --conc=30       limit how many users work at once (default: all)
// Environment: API=http://127.0.0.1:5000  UAT_PASSWORD  UAT_RUN
const fs = require('fs'), path = require('path');
const core = require('./load/core');
const { Client, must, refused, ok, BASE } = require('./lib');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const WS = Number(arg('ws', 5));
const ONLY = arg('only', '');       // e.g. --only=p06,p07 to run just some user types (they are still created for every slot)

const profiles = fs.readdirSync(path.join(__dirname, 'load')).filter(f => /^p\d+.*\.js$/.test(f)).sort().map(f => Object.assign({ file: f }, require('./load/' + f)));
const PER = Number(arg('per', 0)) || profiles.length;       // one user per user type (21 types -> 21 users per workspace, 105 in all)
const CONC = Number(arg('conc', WS * PER));
const phases = [];
const timed = async (name, fn) => { const t = Date.now(); try { return await fn(); } finally { phases.push({ name, s: ((Date.now() - t) / 1000).toFixed(1) }); console.log(`-- ${name}: ${((Date.now() - t) / 1000).toFixed(1)} s`); } };
const rec = (ws, n, profile, id, title, status, note) => core.record({ ws, n, profile, id, title, status, note: note || '', ms: 0 });

(async () => {
  console.log(`API ${BASE}; run ${core.RUN}; ${WS} workspace(s) x ${PER} users; ${profiles.length} user types; concurrency ${CONC}`);
  if (!profiles.length) { console.log('No profiles found in load/'); return; }
  const t0 = Date.now();
  const wss = [];
  await timed('1 create workspaces', async () => {
    await core.pool(Array.from({ length: WS }, (_, i) => i + 1), WS, async i => { try { wss.push(await core.createWorkspace(i)); } catch (e) { console.log('  workspace', i, 'failed:', e.message); rec(i, 0, 'core', 'C-00', 'Create workspace', 'FAIL', e.message); } });
    wss.sort((a, b) => a.i - b.i);
  });
  await timed('2 create and sign in users', async () => {
    await core.pool(wss, WS, async ws => { try { await core.createUsers(ws, profiles, PER); } catch (e) { console.log('  users ws', ws.i, 'failed:', e.message); rec(ws.i, 0, 'core', 'C-01', 'Create users', 'FAIL', e.message); } });
  });
  // plan limit: Starter allows 25 users: add up to 25, the 26th must be refused
  await timed('3 setup per workspace', async () => {
    await core.pool(wss, WS, async ws => {
      for (const p of profiles) {
        if (!p.setup) continue;
        const t = Date.now();
        try { await p.setup(ws); rec(ws.i, 0, p.id, 'setup', 'Workspace setup for ' + p.id, 'PASS'); }
        catch (e) { core.record({ ws: ws.i, n: 0, profile: p.id, id: 'setup', title: 'Workspace setup for ' + p.id, status: 'FAIL', note: String(e.message || e).slice(0, 400), ms: Date.now() - t }); }
      }
    });
  });

  // every user: common checks, then own job
  const jobs = [];
  for (const ws of wss) for (let n = 0; n < PER; n++) if (ws.clients[n]) jobs.push({ ws, n, p: profiles[n % profiles.length] });
  await timed(`4 ${jobs.length} users work at the same time`, async () => {
    await core.pool(jobs, CONC, async ({ ws, n, p }) => {
      const u = core.makeUser(ws, n, p, ws.clients[n]); ws.users[n] = u;
      await u.step('C-01', 'Signed in, /users/me matches, privileges present', async () => {
        const me = must(await u.c.get('/api/users/me'), 'users/me');
        ok(String(me.username).toLowerCase() === u.username.toLowerCase(), `me.username ${me.username} != ${u.username}`);
        const eff = me.effectivePermissions || me.permissions || [];
        ok(eff.length > 0, 'no effective privileges');
        u.perms = eff; return eff.length + ' privileges';
      });
      if (ONLY && !ONLY.split(',').some(x => p.file.startsWith(x))) return;
      try { await p.run(u); } catch (e) { core.record({ ws: ws.i, n, profile: p.id, id: 'run', title: 'script error', status: 'FAIL', note: String(e.stack || e).slice(0, 400), ms: 0 }); }
    });
  });

  await timed('5 permission probes (each user against every other module)', async () => {
    const probes = profiles.filter(p => p.probe).map(p => ({ id: p.id, path: p.probe.path, perm: p.probe.perm }));
    await core.pool(jobs, 30, async ({ ws, n, p }) => {
      const u = ws.users[n]; if (!u || !u.perms) return;
      const has = k => u.perms.includes(k) || u.perms.includes(k.split('.')[0] + '.*');
      await u.step('C-02', 'Modules the user has no privilege for are refused', async () => {
        const bad = [], checked = [];
        for (const pr of probes) { if (has(pr.perm)) continue; const r = await u.c.get(pr.path); checked.push(pr.id); if (r.status >= 200 && r.status < 300) bad.push(`${pr.path} answered ${r.status} without ${pr.perm}`); else if (r.status >= 500) bad.push(`${pr.path} HTTP ${r.status}`); }
        if (bad.length) throw new Error(bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` (+${bad.length - 4} more)` : ''));
        return `${checked.length} modules refused`;
      });
    });
  });

  await timed('6 contention: 20 parallel creates per workspace (unique codes)', async () => {
    await core.pool(wss, WS, async ws => {
      const u = core.makeUser(ws, 0, { id: 'core-contention' }, ws.admin);
      await u.step('C-10', '20 simultaneous leads get 20 different auto-numbers and all are saved', async () => {
        const N = 20;
        const rs = await Promise.all(Array.from({ length: N }, (_, k) => ws.admin.post('/api/erp/crm/records/lead', { company: ws.company, data: { name: `Race lead ${k}`, company: `Race Co ${k}`, email: `race${k}@example.com`, source: 'Web', industry: 'Retail', value: 1000 + k } })));
        const bad = rs.filter(r => !r.ok); ok(bad.length === 0, `${bad.length} of ${N} creates failed: HTTP ${bad[0] && bad[0].status} ${bad[0] && String(bad[0].text).slice(0, 120)}`);
        const codes = rs.map(r => r.data.code); ok(new Set(codes).size === N, `duplicate numbers: ${codes.length - new Set(codes).size} duplicates among ${codes.join(',')}`);
        ws.shared.leadId = rs[0].data.id;
        const list = must(await ws.admin.get('/api/erp/crm/records/lead?take=5000'), 'list leads');
        ok(rs.every(r => list.some(x => x.id === r.data.id)), 'a created lead is missing from the list');
        return `20 codes unique (${codes[0]} .. ${codes[N - 1]})`;
      });
      await u.step('C-11', '20 simultaneous journals get unique numbers', async () => {
        const N = 20;
        const accts = must(await ws.admin.get('/api/finance/records/account'), 'accounts');
        const a = accts.find(x => x.code === '1010') || accts[0], b = accts.find(x => x.code === '3100') || accts[1];
        if (!a || !b) return 'skipped: no chart of accounts in this workspace (finance setup did not run)';
        const rs = await Promise.all(Array.from({ length: N }, (_, k) => ws.admin.post('/api/finance/records/journal', { company: ws.company, status: 'Draft', data: { date: ws.today, memo: `Race journal ${k}`, lines: [{ account: a.code, debit: 10 + k, credit: 0 }, { account: b.code, debit: 0, credit: 10 + k }] } })));
        const bad = rs.filter(r => !r.ok); ok(bad.length === 0, `${bad.length} of ${N} failed: HTTP ${bad[0] && bad[0].status} ${bad[0] && String(bad[0].text).slice(0, 120)}`);
        const codes = rs.map(r => r.data.code); ok(new Set(codes).size === N, `duplicate journal numbers: ${codes.join(',')}`);
        return 'unique';
      });
    });
  });

  await timed('7 isolation between workspaces', async () => {
    if (wss.length < 2) return;
    await core.pool(wss, WS, async ws => {
      const u = core.makeUser(ws, 0, { id: 'core-isolation' }, ws.admin);
      const other = wss.find(x => x.i !== ws.i);
      await u.step('C-20', 'Another workspace\'s records, users and ids are invisible and untouchable', async () => {
        const mine = must(await ws.admin.get('/api/users/admin'), 'users'); const names = mine.map(x => x.username);
        ok(names.every(n => n.startsWith(`l${core.RUN}w${ws.i}u`)), 'user list contains users of another workspace: ' + names.filter(n => !n.startsWith(`l${core.RUN}w${ws.i}u`)).slice(0, 3).join(','));
        const leads = must(await ws.admin.get('/api/erp/crm/records/lead?take=5000'), 'leads');
        ok(!other.shared.leadId || !leads.some(l => l.id === other.shared.leadId), 'a lead of another workspace is visible');
        if (other.shared.leadId) {
          refused(await ws.admin.put('/api/erp/crm/records/lead/' + other.shared.leadId, { status: 'Qualified', data: { name: 'hijack' } }), 'update a lead of another workspace');
          refused(await ws.admin.del('/api/erp/crm/records/lead/' + other.shared.leadId), 'delete a lead of another workspace');
        }
        const foreign = other.admin.info && other.admin.info.id;
        if (foreign) refused(await ws.admin.put('/api/users/admin/' + foreign, { displayName: 'hijack', role: 'admin', isActive: true }), 'edit a user of another workspace');
        return 'users, leads, updates, deletes all contained';
      });
    });
  });

  await timed('8 plan limit (Starter = 25 users)', async () => {
    const ws = wss[0]; if (!ws) return;
    const u = core.makeUser(ws, 0, { id: 'core-limit' }, ws.admin);
    await u.step('C-30', 'Users up to 25 can be added, the 26th is refused with HTTP 402', async () => {
      const have = must(await ws.admin.get('/api/users/admin'), 'users').length;
      let made = 0;
      for (let k = have; k < 25; k++) { must(await ws.admin.post('/api/users/admin', { username: `l${core.RUN}x${k}`, displayName: 'Extra ' + k, role: 'employee', password: core.PASSWORD, isActive: true }), 'extra user ' + k); made++; }
      const r = await ws.admin.post('/api/users/admin', { username: `l${core.RUN}x26`, displayName: 'Extra 26', role: 'employee', password: core.PASSWORD, isActive: true });
      ok(r.status === 402, `the 26th user: expected HTTP 402, got ${r.status}`);
      return `${have} + ${made} = 25; the 26th refused`;
    });
  });

  const t1 = Date.now();
  const md = core.buildReport({ profiles, WS, PER, t0, t1, phases });
  fs.writeFileSync(path.join(__dirname, 'load-report.md'), md);
  fs.writeFileSync(path.join(__dirname, 'load-report.json'), JSON.stringify({ run: core.RUN, api: BASE, records: core.records, serverErrors: core.serverErrors, phases }, null, 2));
  const n = s => core.records.filter(r => r.status === s).length;
  console.log(`\n===== ${n('PASS')} pass, ${n('FAIL')} fail, ${n('MANUAL')} manual; server errors ${core.serverErrors.length}; ${core.calls.length} calls in ${((t1 - t0) / 1000).toFixed(0)} s =====`);
  console.log('Report: load-report.md and load-report.json (send me either file)');
})().catch(e => { console.error('CRASH', e); process.exit(1); });
