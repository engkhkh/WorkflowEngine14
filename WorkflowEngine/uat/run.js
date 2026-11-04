// ERP UAT runner: five users, six days, real API calls, expected figures from the UAT document.
//   node run.js            run everything
//   node run.js --day=2    run one day only (earlier days must already be done in the same workspace: use --keep)
// Environment: API=http://localhost:63353  (the backend's http address)  UAT_PASSWORD=Test@12345
const fs = require('fs'), path = require('path');
const { results, BASE, Client } = require('./lib');
const ORDER = ['u1', 'u3', 'u4', 'u5', 'u2'];     // within a day: Noura (u2) goes last so she sees and books what the others did that day
const only = (process.argv.find(a => a.startsWith('--day=')) || '').split('=')[1];

(async () => {
  console.log('API:', BASE);
  const ctx = require('./u0');                       // bootstrap: workspace, branches, five users
  try { await ctx.bootstrap(); } catch (e) { console.log('BOOTSTRAP FAILED:', e.message); report(ctx); return; }
  const mods = {};
  for (const u of ORDER) { const f = path.join(__dirname, u + '.js'); if (fs.existsSync(f)) mods[u] = require(f); }
  if (mods.u2 && mods.u2.preDay0 && (only === undefined || only === '0')) { console.log('\n=== Day 0 pre-step: finance master data (Noura) ==='); try { await mods.u2.preDay0(ctx); } catch (e) { console.log('  CRASH u2.preDay0', e.stack || e); results.push({ id: 'u2-preDay0', title: 'finance master data', status: 'FAIL', note: String(e.message || e), ms: 0 }); } }
  for (let day = 0; day <= 5; day++) {
    if (only !== undefined && String(day) !== only) continue;
    console.log(`\n=== Day ${day} ===`);
    for (const u of ORDER) {
      const fn = mods[u] && mods[u]['day' + day];
      if (!fn) continue;
      console.log(` [${u}]`);
      try { await fn(ctx); } catch (e) { console.log('  CRASH', u, 'day', day, e.stack || e); results.push({ id: `${u}-day${day}`, title: 'script error', status: 'FAIL', note: String(e.message || e), ms: 0 }); }
    }
  }
  if (mods.u1 && mods.u1.final && (only === undefined || only === '5')) { console.log('\n=== Final: permission and negative checks (Khalid) ==='); try { await mods.u1.final(ctx); } catch (e) { console.log('  CRASH u1.final', e.stack || e); results.push({ id: 'u1-final', title: 'negative checks', status: 'FAIL', note: String(e.message || e), ms: 0 }); } }
  report(ctx);
})();

function report(ctx) {
  const n = s => results.filter(r => r.status === s).length;
  console.log(`\n===== RESULT: ${n('PASS')} pass, ${n('FAIL')} fail, ${n('MANUAL')} manual (browser) of ${results.length} =====`);
  const out = { when: new Date().toISOString(), api: BASE, users: ctx.users || {}, results };
  fs.writeFileSync(path.join(__dirname, 'uat-report.json'), JSON.stringify(out, null, 2));
  const md = ['# UAT run ' + out.when, '', `${n('PASS')} pass / ${n('FAIL')} fail / ${n('MANUAL')} manual`, '', '| ID | Result | Step | Note |', '| --- | --- | --- | --- |']
    .concat(results.map(r => `| ${r.id} | ${r.status} | ${r.title.replace(/\|/g, '/')} | ${String(r.note).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`));
  fs.writeFileSync(path.join(__dirname, 'uat-report.md'), md.join('\n'));
  console.log('Report written: uat-report.md and uat-report.json (send me either file)');
}
