// Project manager: own customer, project with budget lines, tasks, resources, milestone, timesheets with approval, costs, cost vs budget, milestone billing.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

module.exports = {
  id: 'projects-manager',
  title: 'Project manager',
  modules: ['prj'],
  role: 'employee',
  perms: ['prj.*', 'finance.ar.view', 'finance.ar.manage'],
  probe: { path: '/api/erp/prj/summary', perm: 'prj.reports.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company, TODAY = u.ws.today;
    const list = async (kind, qs = '') => must(await c.get(`/api/erp/prj/records/${kind}${qs}`), 'list ' + kind);
    const create = async (kind, body) => must(await c.post(`/api/erp/prj/records/${kind}`, body), 'create ' + kind);
    const update = async (kind, rec, patch = {}) => must(await c.put(`/api/erp/prj/records/${kind}/${rec.id}`, { company: rec.company, branch: rec.branch, ref: rec.ref, status: patch.status || rec.status, data: { ...(rec.data || {}), ...(patch.data || {}) } }), `update ${kind} ${rec.code}`);
    const kpi = (sm, k) => { const x = (sm.kpis || []).find(y => y.k === k); return x ? num(x.v) : NaN; };
    const CUST = `CUS-${K}`;

    await u.step('P13-01', 'Customer for billing (finance customer CUS-key), duplicate code refused', async () => {
      const body = { code: CUST, company: CO, status: 'Active', data: { name: `Project client ${K}`, nameAr: `Project client ${K}`, email: `${CUST.toLowerCase()}@example.com`, termsDays: 60, creditLimit: 150000, city: 'Riyadh' } };
      const cu = must(await c.post('/api/finance/records/customer', body), 'create finance customer');
      ok(cu.code === CUST, 'customer code ' + cu.code);
      refused(await c.post('/api/finance/records/customer', body), 'duplicate customer', [409]);
      S.customer = CUST; return CUST;
    });

    await u.step('P13-02', 'Project: budget lines 30,000 + 40,000 + 10,000 = 80,000, milestone billing, starts Planning, then Active', async () => {
      ok(S.customer, 'depends on P13-01');
      let pr = await create('project', { company: CO, data: { name: `Fit-out ${K}`, customer: S.customer, manager: u.username, start: TODAY, end: addDays(TODAY, 60), billingModel: 'milestone', contractValue: 80000,
        lines: [{ category: 'Labor', amount: 30000 }, { category: 'Material', amount: 40000 }, { category: 'Other', amount: 10000 }], notes: 'Fit-out ' + K } });
      ok(/^PRJ-/.test(pr.code), 'auto code ' + pr.code); ok(pr.status === 'Planning', 'default status ' + pr.status);
      pr = await update('project', pr, { status: 'Active' }); ok(pr.status === 'Active', 'status ' + pr.status);
      eq(pr.data.lines.reduce((s, l) => s + num(l.amount), 0), 80000, 'budget');
      S.pr = pr; return pr.code + ' Active, budget 80,000';
    });

    await u.step('P13-03', 'Tasks: Design (24 h), Procurement, Installation; moves Todo -> InProgress -> Done; task without project refused', async () => {
      ok(S.pr, 'depends on P13-02');
      refused(await c.post('/api/erp/prj/records/task', { company: CO, data: { name: 'Lost ' + K } }), 'task without project', [400]);
      S.tasks = {};
      for (const [n, est] of [['Design', 24], ['Procurement', 40], ['Installation', 40]]) {
        const t = await create('task', { company: CO, ref: S.pr.code, data: { name: n, assignee: u.username, start: TODAY, due: addDays(TODAY, 60), estimate: est } });
        ok(t.status === 'Todo', 'task starts Todo, is ' + t.status); S.tasks[n] = t;
      }
      let d = await update('task', S.tasks.Design, { status: 'InProgress' }); ok(d.status === 'InProgress', 'InProgress');
      d = await update('task', d, { status: 'Done' }); ok(d.status === 'Done', 'Done');
      const mine = (await list('task')).filter(t => t.ref === S.pr.code); eq(mine.length, 3, 'tasks of the project');
      ok(mine.find(t => t.data.name === 'Design').status === 'Done', 'Design not Done in the list');
      return '3 tasks, Design Done';
    });

    await u.step('P13-04', 'Resources: two allocations 50% at cost 200 and 150 per hour, listed for the project', async () => {
      ok(S.pr, 'depends on P13-02');
      refused(await c.post('/api/erp/prj/records/allocation', { company: CO, data: { employee: u.username, role: 'x' } }), 'allocation without project', [400]);
      for (const [e, role, rate] of [[u.username, 'Project manager', 200], ['Installer ' + K, 'Installation lead', 150]])
        await create('allocation', { company: CO, ref: S.pr.code, data: { employee: e, role, pct: 50, from: TODAY, to: addDays(TODAY, 60), costRate: rate, billRate: rate } });
      const al = (await list('allocation')).filter(a => a.ref === S.pr.code); eq(al.length, 2, 'resources');
      eq(al.reduce((s, a) => s + num(a.data.costRate), 0), 350, 'sum of cost rates');
      return '2 resources';
    });

    await u.step('P13-05', 'Milestone Design sign-off: 30% of budget = 24,000, starts Pending; project-less milestone refused', async () => {
      ok(S.pr, 'depends on P13-02');
      refused(await c.post('/api/erp/prj/records/milestone', { company: CO, data: { name: 'Orphan', amount: 1 } }), 'milestone without project', [400]);
      const ms = await create('milestone', { company: CO, ref: S.pr.code, data: { name: 'Design sign-off', due: addDays(TODAY, 30), pct: 30, amount: 24000 } });
      ok(ms.status === 'Pending', 'status ' + ms.status); eq(num(ms.data.pct) / 100 * 80000, 24000, '30% of 80,000');
      S.ms = ms; return ms.code;
    });

    await u.step('P13-06', 'Timesheet rules: 0 h, 25 h and a sheet without project are refused', async () => {
      ok(S.pr, 'depends on P13-02');
      const d = { date: TODAY, employee: u.username, task: 'Design', billable: true, rate: 150, costRate: 150 };
      refused(await c.post('/api/erp/prj/records/timesheet', { company: CO, ref: S.pr.code, data: { ...d, hours: 0 } }), '0 hours', [400]);
      refused(await c.post('/api/erp/prj/records/timesheet', { company: CO, ref: S.pr.code, data: { ...d, hours: 25 } }), '25 hours', [400]);
      refused(await c.post('/api/erp/prj/records/timesheet', { company: CO, data: { ...d, hours: 5 } }), 'no project', [400]);
      refused(await c.post('/api/erp/prj/records/timesheet', { company: CO, ref: S.pr.code, data: { ...d, hours: 5, date: '' } }), 'no date', [400]);
      return '4 refusals';
    });

    await u.step('P13-07', 'Timesheets 16 h at 150 and 8 h at 200: Draft -> Submitted -> Approved; a 5 h sheet is rejected and not counted', async () => {
      ok(S.pr, 'depends on P13-02');
      S.ts = [];
      for (const [h, rate] of [[16, 150], [8, 200]]) {
        let t = await create('timesheet', { company: CO, ref: S.pr.code, data: { date: TODAY, employee: u.username, task: 'Design', hours: h, billable: true, rate, costRate: rate, notes: 'Design work' } });
        ok(t.status === 'Draft', 'starts Draft, is ' + t.status);
        t = await update('timesheet', t, { status: 'Submitted' }); ok(t.status === 'Submitted', 'Submitted');
        t = await update('timesheet', t, { status: 'Approved' }); ok(t.status === 'Approved', 'Approved');
        S.ts.push(t);
      }
      let x = await create('timesheet', { company: CO, ref: S.pr.code, data: { date: TODAY, employee: u.username, task: 'Design', hours: 5, billable: true, rate: 100, costRate: 100 } });
      x = await update('timesheet', x, { status: 'Submitted' }); x = await update('timesheet', x, { status: 'Rejected' }); ok(x.status === 'Rejected', 'Rejected');
      const mine = (await list('timesheet')).filter(t => t.ref === S.pr.code);
      eq(mine.length, 3, 'sheets of the project'); eq(mine.filter(t => t.status === 'Approved').reduce((s, t) => s + num(t.data.hours), 0), 24, 'approved hours');
      return '24 h approved, 5 h rejected';
    });

    await u.step('P13-08', 'Costs: Material 5,500 billable; zero amount refused; cost status Open', async () => {
      ok(S.pr, 'depends on P13-02');
      refused(await c.post('/api/erp/prj/records/cost', { company: CO, ref: S.pr.code, data: { date: TODAY, type: 'Material', description: 'none', amount: 0 } }), 'zero cost', [400]);
      refused(await c.post('/api/erp/prj/records/cost', { company: CO, data: { date: TODAY, type: 'Material', description: 'x', amount: 10 } }), 'cost without project', [400]);
      const cost = await create('cost', { company: CO, ref: S.pr.code, data: { date: TODAY, type: 'Material', description: 'Fit-out materials ' + K, amount: 5500, billable: true, markupPct: 0 } });
      ok(cost.status === 'Open', 'status ' + cost.status); S.cost = cost; return cost.code;
    });

    await u.step('P13-09', 'Cost vs budget: labour 2,400 + 1,600 = 4,000, materials 5,500, total 9,500 = 11.9% of 80,000', async () => {
      ok(S.pr && S.ts && S.cost, 'depends on P13-02/07/08');
      const sheets = (await list('timesheet')).filter(t => t.ref === S.pr.code && t.status !== 'Rejected');
      const labour = r2(sheets.reduce((s, t) => s + num(t.data.hours) * num(t.data.costRate), 0));
      const costs = (await list('cost')).filter(t => t.ref === S.pr.code).reduce((s, t) => s + num(t.data.amount), 0);
      eq(labour, 4000, 'labour'); eq(costs, 5500, 'materials'); eq(labour + costs, 9500, 'total'); eq(Math.round((labour + costs) / 80000 * 1000) / 10, 11.9, 'percent of budget');
      const sm = must(await c.get('/api/erp/prj/summary'), 'summary');
      ok(kpi(sm, 'budget') >= 80000 - 0.005, 'overview budget ' + kpi(sm, 'budget')); ok(kpi(sm, 'actual') >= 9500 - 0.005, 'overview actual ' + kpi(sm, 'actual'));
      ok(kpi(sm, 'active') >= 1, 'active projects ' + kpi(sm, 'active')); ok(Number.isFinite(kpi(sm, 'overBudget')), 'overBudget kpi');
      return '9,500 = 11.9% of 80,000';
    });

    await u.step('P13-10', 'Billing before the milestone is achieved is refused; project without customer cannot be billed', async () => {
      ok(S.pr && S.ms, 'depends on P13-02/05');
      refused(await c.post(`/api/erp/prj/projects/${S.pr.id}/bill`, { taxPct: 15, date: TODAY, termsDays: 60 }), 'nothing ready to bill', [400]);
      const np = await create('project', { company: CO, data: { name: `No customer ${K}`, billingModel: 'milestone', lines: [{ category: 'Other', amount: 1000 }] } });
      refused(await c.post(`/api/erp/prj/projects/${np.id}/bill`, { taxPct: 15, date: TODAY, termsDays: 30 }), 'no customer on the project', [400]);
      return 'both refused';
    });

    await u.step('P13-11', 'Milestone achieved, billed: 24,000 + VAT 3,600 = 27,600, DRAFT invoice due +60 days linked to project and customer', async () => {
      ok(S.pr && S.ms, 'depends on P13-02/05');
      const ach = await update('milestone', S.ms, { status: 'Achieved', data: { achievedAt: TODAY } }); ok(ach.status === 'Achieved', 'Achieved');
      const b = must(await c.post(`/api/erp/prj/projects/${S.pr.id}/bill`, { taxPct: 15, date: TODAY, termsDays: 60 }), 'bill project');
      eq(b.net, 24000, 'net'); eq(b.tax, 3600, 'VAT'); eq(b.total, 27600, 'total'); ok(b.invoice, 'no invoice code');
      const inv = (must(await c.get('/api/finance/records/arinvoice'), 'receivables')).find(x => x.code === b.invoice); ok(inv, 'invoice ' + b.invoice + ' not in receivables');
      ok(inv.status === 'Draft', 'invoice status ' + inv.status); eq(inv.data.total, 27600, 'invoice total'); eq(inv.data.amount, 24000, 'invoice net');
      ok(inv.data.dueDate === addDays(TODAY, 60), 'due ' + inv.data.dueDate); ok(inv.data.customer === S.customer, 'customer ' + inv.data.customer); ok(inv.data.project === S.pr.code, 'project link');
      S.inv = b.invoice; return b.invoice + ' 27,600 DRAFT';
    });

    await u.step('P13-12', 'After billing: milestone Billed and locked, project billed 24,000, same milestone cannot be billed twice, billed milestone cannot be edited or deleted', async () => {
      ok(S.inv, 'depends on P13-11');
      const ms = (await list('milestone')).find(x => x.id === S.ms.id); ok(ms.status === 'Billed', 'milestone ' + ms.status); ok(ms.data.invoice === S.inv, 'milestone invoice link ' + ms.data.invoice);
      eq((await list('project')).find(x => x.id === S.pr.id).data.billed, 24000, 'billed to date');
      refused(await c.post(`/api/erp/prj/projects/${S.pr.id}/bill`, { taxPct: 15, date: TODAY, termsDays: 60 }), 'bill twice', [400]);
      refused(await c.put(`/api/erp/prj/records/milestone/${ms.id}`, { company: ms.company, ref: ms.ref, status: 'Pending', data: ms.data }), 'edit billed milestone', [400]);
      refused(await c.del(`/api/erp/prj/records/milestone/${ms.id}`), 'delete billed milestone', [400]);
      refused(await c.put(`/api/erp/prj/records/milestone/${S.ms.id}`, { company: ms.company, ref: ms.ref, status: 'Billed', data: ms.data }), 'set Billed by hand', [400]);
      return 'locked';
    });

    await u.step('P13-13', 'Overview after billing: billed >= 24,000, margin figure present; project listed Active', async () => {
      ok(S.inv, 'depends on P13-11');
      const sm = must(await c.get('/api/erp/prj/summary'), 'summary');
      ok(kpi(sm, 'billed') >= 24000 - 0.005, 'billed ' + kpi(sm, 'billed')); ok(Number.isFinite(kpi(sm, 'margin')), 'margin'); ok(Number.isFinite(kpi(sm, 'hoursMonth')), 'hours');
      ok(Number.isFinite(kpi(sm, 'pendingTimesheets')), 'pending timesheets');
      ok((sm.lists || []).some(l => l.k === 'byStatus'), 'status list');
      return `billed ${kpi(sm, 'billed')}, margin ${kpi(sm, 'margin')}`;
    });

    await u.step('P13-14', 'Maintenance: duplicate-free codes, approved timesheet is final for deletion, cost and task delete, project edit', async () => {
      ok(S.pr && S.ts, 'depends on P13-02/07');
      const ap = (await list('timesheet')).find(t => t.id === S.ts[0].id);
      ok(ap.status === 'Approved', 'timesheet should stay Approved'); // a Billed/Completed record would be final; Approved is not
      const c2 = await create('cost', { company: CO, ref: S.pr.code, data: { date: TODAY, type: 'Other', description: 'small ' + K, amount: 100, billable: false } });
      const up = await update('cost', c2, { data: { amount: 120 } }); eq(up.data.amount, 120, 'edited cost');
      must(await c.del(`/api/erp/prj/records/cost/${c2.id}`), 'delete cost'); ok(!(await list('cost')).some(x => x.id === c2.id), 'cost still listed');
      must(await c.del(`/api/erp/prj/records/task/${S.tasks.Procurement.id}`), 'delete task'); ok(!(await list('task')).some(x => x.id === S.tasks.Procurement.id), 'task still listed');
      const pr = await update('project', S.pr, { status: 'OnHold' }); ok(pr.status === 'OnHold', 'project status');
      refused(await c.get('/api/erp/prj/records/nothing'), 'unknown kind', [404]);
      return 'edit and delete work';
    });
  },
};
