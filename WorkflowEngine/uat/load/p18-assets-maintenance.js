// Asset and maintenance engineer: fixed-asset classes + depreciation numbers (finance records), maintenance assets, meters, plans every N days,
// work orders from plans (start / complete / cancel), corrective orders, downtime, retirement, overview.
const { must, refused, eq, ok, addDays } = require('../lib');
const num = x => Number(x);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = {
  id: 'assets-maintenance',
  title: 'Asset and maintenance engineer',
  modules: ['ast'],
  role: 'admin-stores',
  perms: ['ast.*', 'finance.assets.*', 'finance.reports.view'],
  probe: { path: '/api/erp/ast/records/asset', perm: 'ast.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, ws = u.ws, CO = ws.company || undefined;
    const A = { pump: `PMP-${K}`, gen: `GEN-${K}`, cmp: `CMP-${K}` };
    const utcToday = new Date().toISOString().slice(0, 10);
    const ast = (kind, qs = '') => c.get(`/api/erp/ast/records/${kind}${qs}`);
    const astList = async (kind, qs = '') => must(await ast(kind, qs), 'list ' + kind);
    const fin = async kind => must(await c.get(`/api/finance/records/${kind}`), 'finance ' + kind);

    await u.step('AST-01', 'Fixed-asset classes: two classes created; duplicate and codeless refused', async () => {
      must(await c.post('/api/finance/records/assetclass', { code: `CLS5-${K}`, status: 'Active', data: { name: 'Plant 5 years ' + K, lifeMonths: 60, method: 'SL' } }), 'class 5y');
      must(await c.post('/api/finance/records/assetclass', { code: `CLS3-${K}`, status: 'Active', data: { name: 'IT 3 years ' + K, lifeMonths: 36, method: 'SL' } }), 'class 3y');
      refused(await c.post('/api/finance/records/assetclass', { code: `CLS5-${K}`, status: 'Active', data: { name: 'dup' } }), 'duplicate class', [409]);
      refused(await c.post('/api/finance/records/assetclass', { status: 'Active', data: { name: 'no code' } }), 'class without code', [400]);
      const l = (await fin('assetclass')).filter(x => String(x.code).endsWith('-' + K));
      eq(l.length, 2, 'my classes'); eq(l.find(x => x.code === `CLS5-${K}`).data.lifeMonths, 60, 'life');
      return '2 classes';
    });

    await u.step('AST-02', 'Depreciation: 36,000 over 60 months = 600/month, 12,000 less 2,000 salvage over 50 months = 200/month; three months booked', async () => {
      const mk = (code, cls, cost, salvage, life) => c.post('/api/finance/records/asset', { code, company: CO, status: 'Active', data: { name: 'Asset ' + code, class: cls, cost, salvage, lifeMonths: life, method: 'SL', inServiceDate: ws.today.slice(0, 8) + '01', accumulated: 0, location: 'Riyadh' } });
      const a1 = must(await mk(`FA1-${K}`, `CLS5-${K}`, 36000, 0, 60), 'asset 1'), a2 = must(await mk(`FA2-${K}`, `CLS3-${K}`, 12000, 2000, 50), 'asset 2');
      refused(await mk(`FA1-${K}`, `CLS5-${K}`, 1, 0, 1), 'duplicate asset', [409]);
      const dep1 = r2((36000 - 0) / 60), dep2 = r2((12000 - 2000) / 50);
      eq(dep1, 600, 'monthly 1'); eq(dep2, 200, 'monthly 2');
      const book = async (a, monthly, months) => must(await c.put(`/api/finance/records/asset/${a.id}`, { status: 'Active', data: { ...a.data, accumulated: r2(monthly * months), lastPeriod: ws.today.slice(0, 7) } }), 'book depreciation');
      const b1 = await book(a1, dep1, 3), b2 = await book(a2, dep2, 3);
      eq(b1.data.accumulated, 1800, 'accumulated 1'); eq(r2(36000 - num(b1.data.accumulated)), 34200, 'NBV 1');
      eq(b2.data.accumulated, 600, 'accumulated 2'); eq(r2(12000 - num(b2.data.accumulated)), 11400, 'NBV 2');
      const mine = (await fin('asset')).filter(x => String(x.code).endsWith('-' + K));
      eq(mine.reduce((a, x) => a + num(x.data.cost), 0), 48000, 'cost of my fixed assets'); eq(mine.reduce((a, x) => a + num(x.data.accumulated), 0), 2400, 'accumulated of my fixed assets');
      const s = must(await c.get('/api/finance/summary'), 'finance summary');
      ok(s.assetCount >= 2 && s.assetCost >= 48000 && s.assetAccumulated >= 2400, `finance summary assets ${s.assetCount}/${s.assetCost}/${s.assetAccumulated}`);
      return 'NBV 34,200 and 11,400';
    });

    await u.step('AST-03', 'Maintenance assets: pump, generator, compressor created; no name and duplicate refused; location updated', async () => {
      const mk = (code, name, cost, extra = {}) => c.post('/api/erp/ast/records/asset', { code, company: CO, data: { name, category: 'Machinery', location: 'Plant', cost, criticality: 'High', ...extra } });
      S.pump = must(await mk(A.pump, 'Pump ' + K, 20000), 'pump'); S.gen = must(await mk(A.gen, 'Generator ' + K, 50000), 'generator'); S.cmp = must(await mk(A.cmp, 'Compressor ' + K, 8000, { criticality: 'Low' }), 'compressor');
      eq(S.pump.status, 'Active', 'default status');
      refused(await mk(A.pump, 'dup', 1), 'duplicate asset code', [409]);
      refused(await mk(`NN-${K}`, '', 1), 'asset without name', [400]);
      const up = must(await c.put(`/api/erp/ast/records/asset/${S.pump.id}`, { data: { ...S.pump.data, location: 'Plant B' } }), 'update location');
      eq(up.data.location, 'Plant B', 'location');
      eq((await astList('asset')).filter(a => String(a.code).endsWith('-' + K)).length, 3, 'my assets');
      return '3 assets, 78,000 total';
    });

    await u.step('AST-04', 'Meter readings 120 / 150 / 185 h on the pump are stored per asset; usage since first reading = 65', async () => {
      ok(S.pump, 'depends on AST-03');
      for (const [d, v] of [[addDays(ws.today, -20), 120], [addDays(ws.today, -10), 150], [ws.today, 185]])
        must(await c.post('/api/erp/ast/records/meter', { company: CO, ref: A.pump, data: { date: d, meter: 'Hours', value: v, notes: 'reading ' + K } }), 'meter ' + v);
      must(await c.post('/api/erp/ast/records/meter', { company: CO, ref: A.gen, data: { date: ws.today, meter: 'Hours', value: 40 } }), 'generator meter');
      const l = (await astList('meter', '?ref=' + encodeURIComponent(A.pump))).sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)));
      eq(l.length, 3, 'pump readings'); ok(l.every(r => r.ref === A.pump), 'a reading of another asset leaked');
      eq(num(l[2].data.value) - num(l[0].data.value), 65, 'usage'); ok(l[0].code, 'reading has no auto number');
      return 'usage 65 h';
    });

    await u.step('AST-05', 'Plan every 30 days: work order generated (Open, Preventive, due date), plan moves on by 30 days; second order 30 days later', async () => {
      ok(S.pump, 'depends on AST-03');
      const due = addDays(ws.today, 30);
      const plan = must(await c.post('/api/erp/ast/records/plan', { company: CO, ref: A.pump, data: { name: 'Pump service ' + K, frequencyDays: 30, nextDue: due, task: 'Seals and bearings' } }), 'plan');
      eq(plan.status, 'Active', 'plan status'); S.plan = plan;
      const wo = must(await c.post(`/api/erp/ast/plans/${plan.id}/generate`, {}), 'generate 1');
      eq(wo.status, 'Open', 'wo status'); eq(wo.ref, A.pump, 'wo asset'); eq(wo.parent, plan.code, 'wo plan'); eq(wo.data.due, due, 'wo due'); eq(wo.data.type, 'Preventive', 'type'); eq(wo.data.description, 'Seals and bearings', 'description');
      const p2 = (await astList('plan')).find(p => p.id === plan.id); eq(p2.data.nextDue, addDays(due, 30), 'next due moved');
      const wo2 = must(await c.post(`/api/erp/ast/plans/${plan.id}/generate`, {}), 'generate 2'); eq(wo2.data.due, addDays(due, 30), 'second due');
      ok(wo.code !== wo2.code, 'work orders share a number');
      refused(await c.post(`/api/erp/ast/plans/nope-${K}/generate`, {}), 'unknown plan', [404]);
      S.wo = wo; S.wo2 = wo2;
      return `${wo.code} due ${due}, ${wo2.code} due ${wo2.data.due}`;
    });

    await u.step('AST-06', 'Overdue plan (due 3 days ago, every 7 days): order carries the past due date, plan next due = today + 4; overview counts it as due', async () => {
      ok(S.gen, 'depends on AST-03');
      const past = addDays(ws.today, -3);
      const plan = must(await c.post('/api/erp/ast/records/plan', { company: CO, ref: A.gen, data: { name: 'Generator check ' + K, frequencyDays: 7, nextDue: past, task: 'Oil and filters' } }), 'overdue plan');
      const due0 = (await astList('plan')).find(p => p.id === plan.id);
      const s0 = must(await c.get('/api/erp/ast/summary'), 'summary');
      ok(s0.kpis.find(k => k.k === 'dueMaintenance').v >= 1, 'dueMaintenance should count the overdue plan');
      const wo = must(await c.post(`/api/erp/ast/plans/${plan.id}/generate`, {}), 'generate'); eq(wo.data.due, past, 'due date');
      eq((await astList('plan')).find(p => p.id === plan.id).data.nextDue, addDays(past, 7), 'next due');
      S.genWo = wo;
      return `due ${past}, next ${addDays(past, 7)}; plan was due: ${due0.data.nextDue}`;
    });

    await u.step('AST-07', 'Work order lifecycle: start, start again refused, complete 450 / 3 h, asset last service set; completed order is final', async () => {
      ok(S.wo, 'depends on AST-05');
      const st = must(await c.post(`/api/erp/ast/aworkorders/${S.wo.id}/start`, {}), 'start'); eq(st.status, 'InProgress', 'in progress'); ok(st.data.startedAt, 'startedAt');
      refused(await c.post(`/api/erp/ast/aworkorders/${S.wo.id}/start`, {}), 'start twice', [400]);
      refused(await c.post(`/api/erp/ast/aworkorders/${S.wo.id}/complete`, { cost: -1, hours: 1 }), 'negative cost', [400]);
      refused(await c.post(`/api/erp/ast/aworkorders/${S.wo.id}/complete`, { cost: 1, hours: -2 }), 'negative hours', [400]);
      const done = must(await c.post(`/api/erp/ast/aworkorders/${S.wo.id}/complete`, { cost: 450, hours: 3, note: 'Seals replaced ' + K }), 'complete');
      eq(done.status, 'Completed', 'completed'); eq(done.data.actualCost, 450, 'cost'); eq(done.data.hours, 3, 'hours'); ok(done.data.completedAt, 'completedAt');
      const a = (await astList('asset')).find(x => x.id === S.pump.id); ok(a.data.lastService, 'asset lastService not set'); ok(String(a.data.lastService).slice(0, 4) === utcToday.slice(0, 4), 'lastService ' + a.data.lastService);
      refused(await c.post(`/api/erp/ast/aworkorders/${S.wo.id}/complete`, { cost: 1, hours: 1 }), 'complete twice', [400]);
      refused(await c.post(`/api/erp/ast/aworkorders/${S.wo.id}/cancel`, {}), 'cancel after completion', [400]);
      refused(await c.del(`/api/erp/ast/records/workorder/${S.wo.id}`), 'delete completed order', [400]);
      return 'completed with 450 and 3 h';
    });

    await u.step('AST-08', 'Corrective order: created Open, no asset / forged status / status edit refused, cancel works, cancelled cannot start', async () => {
      ok(S.cmp, 'depends on AST-03');
      const body = (extra = {}) => ({ company: CO, ref: A.cmp, data: { type: 'Corrective', description: 'Leak ' + K, priority: 'High', due: addDays(ws.today, 2) }, ...extra });
      const wo = must(await c.post('/api/erp/ast/records/workorder', body()), 'create corrective'); eq(wo.status, 'Open', 'status'); ok(wo.code, 'auto number');
      refused(await c.post('/api/erp/ast/records/workorder', { company: CO, data: { type: 'Corrective' } }), 'order without asset', [400]);
      refused(await c.post('/api/erp/ast/records/workorder', body({ status: 'Completed' })), 'forged completed status', [400]);
      refused(await c.put(`/api/erp/ast/records/workorder/${wo.id}`, { status: 'Completed', data: wo.data }), 'status edited by hand', [400]);
      const ca = must(await c.post(`/api/erp/ast/aworkorders/${wo.id}/cancel`, {}), 'cancel'); eq(ca.status, 'Cancelled', 'cancelled');
      refused(await c.post(`/api/erp/ast/aworkorders/${wo.id}/start`, {}), 'start cancelled', [400]);
      refused(await c.post(`/api/erp/ast/aworkorders/${wo.id}/explode`, {}), 'unknown action', [404]);
      ok((await c.del(`/api/erp/ast/records/workorder/${wo.id}`)).status === 204, 'delete cancelled order');
      return 'cancelled and removed';
    });

    await u.step('AST-09', 'Downtime: compressor set Down (counted in overview), repair order 6 h / 120, back to Active; availability 99.17% of a 720 h month', async () => {
      ok(S.cmp, 'depends on AST-03');
      must(await c.put(`/api/erp/ast/records/asset/${S.cmp.id}`, { status: 'Down', data: S.cmp.data }), 'set down');
      const s1 = must(await c.get('/api/erp/ast/summary'), 'summary down'); ok(s1.kpis.find(k => k.k === 'down').v >= 1, 'down count');
      const wo = must(await c.post('/api/erp/ast/records/workorder', { company: CO, ref: A.cmp, data: { type: 'Corrective', description: 'Breakdown ' + K, priority: 'High', due: ws.today } }), 'repair order');
      must(await c.post(`/api/erp/ast/aworkorders/${wo.id}/start`, {}), 'start');
      const done = must(await c.post(`/api/erp/ast/aworkorders/${wo.id}/complete`, { cost: 120, hours: 6, note: 'Downtime repair' }), 'complete'); eq(done.data.hours, 6, 'downtime hours');
      must(await c.put(`/api/erp/ast/records/asset/${S.cmp.id}`, { status: 'Active', data: S.cmp.data }), 'back to active');
      eq((await astList('asset')).find(a => a.id === S.cmp.id).status, 'Active', 'status after repair');
      eq(r2((720 - 6) / 720 * 100), 99.17, 'availability %');
      S.repair = done;
      return 'availability 99.17%';
    });

    await u.step('AST-10', 'Retire the generator: status Retired is listed under the Retired filter and leaves the active asset set', async () => {
      ok(S.gen, 'depends on AST-03');
      must(await c.put(`/api/erp/ast/records/asset/${S.gen.id}`, { status: 'Retired', data: S.gen.data }), 'retire');
      ok((await astList('asset', '?status=Retired')).some(a => a.id === S.gen.id), 'not in Retired filter');
      ok(!(await astList('asset', '?status=Active')).some(a => a.id === S.gen.id), 'still Active');
      return 'generator Retired';
    });

    await u.step('AST-11', 'Overview: assets, open orders, maintenance cost this month >= 570, asset value >= 28,000, order mix by status', async () => {
      const s = must(await c.get('/api/erp/ast/summary'), 'summary');
      const k = n => { const x = s.kpis.find(y => y.k === n); ok(x, 'kpi ' + n + ' missing'); return x.v; };
      ok(k('assets') >= 2, 'assets ' + k('assets')); ok(k('openWo') >= 1, 'openWo (the second planned order is open)');
      ok(k('maintCostMonth') >= 570, 'maintenance cost ' + k('maintCostMonth') + ' (450 + 120 completed by me)');
      ok(k('assetValue') >= 28000, 'asset value ' + k('assetValue') + ' (pump 20,000 + compressor 8,000, generator retired)');
      const by = s.lists.find(l => l.k === 'woByStatus'); ok(by && by.rows.some(r => r.name === 'Completed' && r.value >= 2), 'Completed orders in woByStatus');
      ok(s.lists.some(l => l.k === 'byCategory' && l.rows.some(r => r.name === 'Machinery')), 'byCategory Machinery');
      return `assets ${k('assets')}, open orders ${k('openWo')}, cost ${k('maintCostMonth')}, value ${k('assetValue')}`;
    });

    u.manual('AST-12', 'Spare parts and a dedicated downtime log', 'The assets module has no spare-part or downtime record kinds in the API (ModulesController.Ext.cs lists only asset, plan, workorder, meter, setting). Downtime is covered through the Down status and corrective order hours (AST-09).');
  },
};
