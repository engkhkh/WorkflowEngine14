#!/usr/bin/env node
// Finds the running backend (tries the usual ports on 127.0.0.1 and localhost), then fills the workspace of an existing user.
//   node seed-admin.js [--existing=admin] [--password=admin123] [--admin=3]     (set API=http://host:port to force one address)
const cands = process.env.API ? [process.env.API] : ['http://127.0.0.1:63353', 'http://127.0.0.1:5000', 'http://localhost:63353', 'http://localhost:5000', 'http://127.0.0.1:5055', 'https://localhost:63353', 'https://localhost:7000'];
(async () => {
  let found = null;
  for (const b of cands) {
    try { const r = await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) }); found = b; console.log(`Backend answers at ${b} (HTTP ${r.status})`); break; }
    catch (e) { console.log(`  no answer at ${b}: ${(e.cause && e.cause.code) || e.message}`); }
  }
  if (!found) { console.error('\nNo backend found. Start it (dotnet run in backend\\WorkflowEngine.Api), read the "Now listening on: http://..." line and run again with:  set API=http://localhost:PORT'); process.exit(1); }
  process.env.API = found;
  if (!process.argv.some(a => a.startsWith('--existing='))) process.argv.push('--existing=' + (process.env.ADMIN_USER || 'admin'));
  require('./seed.js');
})();
