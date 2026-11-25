#!/usr/bin/env node
// Removes the surplus demo custom modules "Visitors-A19R2", "Visitors-A19R3" ... (keeps the first one of each name family).
//   set API=http://localhost:5000   node cleanup-custom.js [--user=admin] [--password=admin123] [--dry] [--all]   (--all also removes the last Visitors-A19R1 / Visitors-W..U.. modules)
// find the backend like seed-admin.js does (PowerShell: use  $env:API="http://localhost:5000"  - "set API=..." does not work there)
const cands = process.env.API ? [process.env.API] : ['http://127.0.0.1:63353', 'http://127.0.0.1:5000', 'http://localhost:63353', 'http://localhost:5000', 'http://127.0.0.1:5055'];
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
(async () => {
  for (const b of cands) { try { await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) }); process.env.API = b; break; } catch { /* next */ } }
  if (!process.env.API) { console.error('No backend found. Start it first, or set $env:API="http://localhost:PORT" (PowerShell) / set API=http://localhost:PORT (cmd).'); process.exit(1); }
  const { Client, BASE } = require('./lib');
  const c = new Client(arg('user', 'admin')); await c.login(arg('user', 'admin'), arg('password', process.env.UAT_ADMIN_PASSWORD || 'admin123'));
  const mods = (await c.get('/api/custom/modules')).data || [];
  const T = m => (m.def && m.def.title) || m.title || m.name || '';
  console.log(`signed in as ${c.name}: ${Array.isArray(mods) ? mods.length : 'unexpected reply'} custom modules visible: ${(Array.isArray(mods) ? mods : []).map(T).slice(0, 12).join(', ')}${mods.length > 12 ? ' ...' : ''}`);
  if (!Array.isArray(mods) || !mods.length) console.log('Nothing here. The modules you saw belong to another account/workspace: run again with  --user=NAME --password=PASSWORD  (e.g. --user=ldemow1u00 --password=Test@12345 for the separate demo workspace).');
  const demo = mods.filter(m => /^Visitors-/i.test(T(m)));
  const keep = new Set(), seen = new Set(), kill = [];      // keep ONE module of each name family: the first "Visitors-A19R1" and one "Visitors-Wn Un"
  for (const m of demo) { const t = T(m).toLowerCase(); const fam = /^visitors-a19r1$/.test(t) ? 'a' : /^visitors-w\d+u\d+$/.test(t) ? 'w' : ''; if (!process.argv.includes('--all') && fam && !seen.has(fam)) { seen.add(fam); keep.add(m.key); } else kill.push(m); }
  console.log(`${demo.length} demo modules found on ${BASE}; keeping ${keep.size}, removing ${kill.length}`);
  if (process.argv.includes('--dry')) return;
  let n = 0;
  for (const m of kill) {
    const recs = await c.get(`/api/custom/records/${m.key}`); for (const r of (Array.isArray(recs.data) ? recs.data : (recs.data && recs.data.items) || [])) await c.del(`/api/custom/records/${m.key}/${r.id}`);
    const d = await c.del(`/api/custom/modules/${m.key}`); if (d.ok || d.status === 204) n++; else console.log(`  could not remove ${T(m)}: HTTP ${d.status} ${String(d.text).slice(0, 100)}`);
  }
  console.log(`removed ${n} modules`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
