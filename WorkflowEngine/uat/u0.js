// Day-0 bootstrap shared by everybody: creates the workspace, the three branches and the five users with their extra privileges.
const { Client, must, step, ok } = require('./lib');
const PASSWORD = process.env.UAT_PASSWORD || 'Test@12345';
const RUN = process.env.UAT_RUN || String(Date.now()).slice(-5);       // makes usernames unique so the run can be repeated
const ctx = { run: RUN, password: PASSWORD, U: {}, users: {}, S: {}, branch: {}, company: null, perms: {}, today: null };
const NAMES = {
  khalid: { display: 'Khalid Al-Rashid', role: 'admin' },
  noura:  { display: 'Noura Al-Dossari', role: 'finance',     extra: ['finance.*', 'epm.*', 'pay.view', 'pay.run.approve', 'pay.post', 'pay.reports.view', 'ast.*', 'bi.view', 'proc.po.approve', 'proc.invoice', 'pay.setup', 'cal.*', 'mus.view'] },
  faisal: { display: 'Faisal Al-Ghamdi', role: 'procurement', extra: ['scm.*', 'wh.*', 'mfg.*', 'ast.view', 'inventory.*', 'purchasing.*', 'proc.receive', 'pos.products.manage', 'pos.stock.manage', 'pos.stock.view', 'cal.*'] },
  reem:   { display: 'Reem Al-Mutairi', role: 'sales',        extra: ['pos.*', 'prj.*', 'web.view', 'web.orders.manage', 'sales.*', 'cus.view', 'cus.manage', 'cus.design', 'pay.self', 'cal.*', 'crm.*'] },
  sara:   { display: 'Dr. Sara Al-Otaibi', role: 'doctor',    extra: ['hos.*', 'hr.*', 'pay.run.manage', 'pay.setup', 'pay.view', 'pay.self', 'pay.payslips.view', 'mus.view', 'cal.*'] },
};
ctx.names = NAMES;
const uname = k => `${k}.${RUN}`;
ctx.username = uname;

ctx.bootstrap = async function () {
  console.log(`Run id ${RUN}: usernames look like khalid.${RUN}; password ${PASSWORD}`);
  const kh = new Client('khalid'); ctx.U.khalid = kh;
  await step('U1-01', 'Create workspace Al-Noor Medical & Trading Group with admin Khalid', async () => {
    const r = await kh.post('/api/tenants/signup', { workspaceName: `Al-Noor Medical & Trading Group ${RUN}`, branches: ['Riyadh', 'Jeddah', 'Dammam'], displayName: NAMES.khalid.display,
      username: uname('khalid'), password: PASSWORD, currency: 'SAR', country: 'SA', email: `khalid.${RUN}@example.com` });
    const d = must(r, 'signup'); kh.token = d.token; kh.info = d; ctx.users.khalid = uname('khalid');
    return 'workspace ' + d.tenantId;
  });
  if (!kh.token) throw new Error('cannot continue without the admin account');
  await step('U1-02', 'Three branches exist (Riyadh, Jeddah, Dammam), currency SAR', async () => {
    const o = must(await kh.get('/api/org'), 'org');
    const br = o.branches || o.Branches || [];
    const comp = (o.companies || o.Companies || [])[0];
    ctx.company = comp && (comp.code || comp.Code);
    for (const [k, n] of [['RYD', 'Riyadh'], ['JED', 'Jeddah'], ['DMM', 'Dammam']]) {
      const b = br.find(x => (x.name || x.Name) === n); ok(b, `branch ${n} missing`); ctx.branch[k] = b.code || b.Code;
    }
    ok(comp && (comp.currency || comp.Currency) === 'SAR', 'company currency is not SAR');
    return JSON.stringify(ctx.branch) + ' company ' + ctx.company;
  });
  const cat = must(await kh.get('/api/users/permissions'), 'permission catalog');
  const all = cat.groups.flatMap(g => g.keys || g.Keys || []);
  ctx.perms.all = all; ctx.perms.roleDefaults = cat.roleDefaults;
  const expand = list => list.flatMap(p => p.endsWith('.*') ? all.filter(k => k.startsWith(p.slice(0, -1))) : [p]);
  await step('U1-04', 'Create noura, faisal, reem, sara with roles and extra privileges', async () => {
    const made = [];
    for (const k of ['noura', 'faisal', 'reem', 'sara']) {
      const n = NAMES[k];
      const base = cat.roleDefaults[n.role] || [];
      const perms = [...new Set([...base, ...expand(n.extra)])];
      const homeBranch = { noura: 'RYD', faisal: 'JED', reem: 'DMM', sara: 'RYD' }[k];
      const r = await kh.post('/api/users/admin', { username: uname(k), displayName: n.display, email: `${k}.${RUN}@example.com`, role: n.role, password: PASSWORD, permissions: perms, isActive: true });
      const d = must(r, 'create ' + k); ctx.users[k] = uname(k); ctx.perms[k] = d.effectivePermissions || perms; ctx['id_' + k] = d.id; made.push(`${k}:${(d.effectivePermissions || perms).length} privileges`);
    }
    return made.join(', ');
  });
  await step('U1-04b', 'Each of the four users signs in with the password', async () => {
    for (const k of ['noura', 'faisal', 'reem', 'sara']) { const c = new Client(k); await c.login(uname(k), PASSWORD); ctx.U[k] = c; }
  });
  ctx.today = new Date().toISOString().slice(0, 10);
};
// Handy for the user scripts
ctx.has = (user, perm) => (ctx.perms[user] || []).includes(perm);
module.exports = ctx;
