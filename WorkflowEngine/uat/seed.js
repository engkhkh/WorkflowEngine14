#!/usr/bin/env node
/**
 * Fill ONE demo workspace with realistic data in EVERY module (finance, procurement, warehouse, manufacturing, CRM,
 * sales, POS, website, projects, hospital, HR, payroll, assets, collaboration, custom modules, archive ...), so every
 * screen has records to open, edit and approve.
 *
 *   $env:API="http://127.0.0.1:5000"
 *   node seed.js                  # creates workspace "Demo", users  ldemow1u00 .. ldemow1u20, password Test@12345
 *   node seed.js --tag=hosp       # another independent demo workspace: users  lhospw1u00 ..
 *   node seed.js --rounds=2       # each module user runs the job 2 times
 *   node seed.js --admin=5        # the administrator ldemow1u00 also runs every module's job 5 times (default 3)
 *
 * It uses the same proven job per module as the load test (create, update, status changes, approvals, postings), but with
 * one user per module so the data is not deleted again. Sign in as  ldemow1u00  (administrator, sees everything).
 */
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
process.env.UAT_RUN = arg('tag', 'demo');
const fs = require('fs'), path = require('path');
const core = require('./load/core');
const { must, ok } = require('./lib');
const ROUNDS = Number(arg('rounds', 1));          // extra rounds of every module's job
const AS_ADMIN = Number(arg('admin', 3));         // extra rounds done by the administrator himself (ldemow1u00), so his own screens are full too
const profiles = fs.readdirSync(path.join(__dirname, 'load')).filter(f => /^p\d+.*\.js$/.test(f)).sort().map(f => Object.assign({ file: f }, require('./load/' + f)));

(async () => {
  const t0 = Date.now();
  console.log(`Seeding demo workspace (tag "${core.RUN}") with ${profiles.length} modules/user types, ${ROUNDS} round(s) ...`);
  const ws = await core.createWorkspace(1);
  await core.createUsers(ws, profiles, profiles.length);
  console.log(`-- ${profiles.length} users created`);
  for (const p of profiles) { if (!p.setup) continue; try { await p.setup(ws); } catch (e) { console.log(`  setup ${p.id}: ${e.message}`); } }
  console.log('-- chart of accounts, items, branches, master data ready');
  const jobs = [];
  for (let r = 0; r < ROUNDS; r++) for (let n = 0; n < profiles.length; n++) if (ws.clients[n]) jobs.push({ n, p: profiles[n % profiles.length], r, admin: false });
  // the administrator runs every module's job himself (he holds every privilege), so he owns records in all modules:
  // his own timesheets, tasks, leave, payslips ... are not empty, and every list has much more data.
  for (let r = 1; r <= AS_ADMIN; r++) for (let n = 1; n < profiles.length; n++) jobs.push({ n, p: profiles[n % profiles.length], r, admin: true });
  let done = 0;
  await core.pool(jobs, 5, async ({ n, p, r, admin }) => {
    const u = core.makeUser(ws, admin ? 0 : n, p, admin ? ws.admin : ws.clients[n]);
    if (admin) { u.key = `A${String(n).padStart(2, '0')}R${r}`; u.tag = `9${String(n).padStart(2, '0')}${r}`; }
    else if (r > 0) { u.key = u.key + 'R' + r; u.tag = u.tag + r; }
    try { await p.run(u); } catch (e) { console.log(`  ${p.id}: ${String(e.message || e).split('\n')[0]}`); }
    done++; process.stdout.write(`\r  ${done}/${jobs.length} module jobs done  `);
  });
  process.stdout.write('\n');
  const rec = core.records, pass = rec.filter(x => x.status === 'PASS').length, fail = rec.filter(x => x.status === 'FAIL');
  const lines = [`# Demo data - login list`, '', `Workspace password for every user: **${core.PASSWORD}**`, '', '| Username | Module / user type |', '| --- | --- |'];
  profiles.forEach((p, n) => lines.push(`| ${core.uname(1, n)}${n === 0 ? ' (administrator, sees everything)' : ''} | ${p.title} (${(p.modules || []).join(', ')}) |`));
  lines.push('', `${pass} records/actions created and verified, ${fail.length} steps failed, ${core.serverErrors.length} server errors, ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
  if (fail.length) { lines.push('', '## Steps that failed', '', 'Steps that check "this user is refused" fail when the administrator runs them (he is never refused) - that is expected. Others mean data of that step is missing.', ''); for (const f of fail.slice(0, 60)) lines.push(`- ${f.profile} ${f.id} ${f.title}: ${f.note}`); }
  fs.writeFileSync(path.join(__dirname, 'seed-report.md'), lines.join('\n'));
  console.log(lines.slice(0, 5 + profiles.length + 2).join('\n'));
  console.log(`\nSign in at the portal/mobile as ${core.uname(1, 0)} / ${core.PASSWORD}. Details: uat/seed-report.md`);
})().catch(e => { console.error(e); process.exit(1); });
