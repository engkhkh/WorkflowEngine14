// Payroll officer: pay elements, adjustments, run create -> calculate -> approve (admin) -> post (admin), payslips, self-service, hire-date rule.
const { Client, must, refused, eq, ok, addDays } = require('../lib');
const { PASSWORD } = require('./core');
const num = x => Number(x);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const erp = (kind, o) => ({ id: 'new', module: 'pay', kind, ...o });

module.exports = {
  id: 'payroll-officer',
  title: 'Payroll officer',
  modules: ['pay'],
  role: 'hr',
  perms: ['pay.setup', 'pay.run.manage', 'pay.payslips.view', 'pay.reports.view'],
  probe: { path: '/api/erp/pay/records/run', perm: 'pay.view' },

  /** Chart of accounts + payroll accounts once per workspace, so that the admin can post the run. */
  async setup(ws) {
    const a = ws.admin;
    const seed = await a.post('/api/finance/accounts/seed', {});
    if (!seed.ok && seed.status !== 409) must(seed, 'seed accounts');
    const accts = must(await a.get('/api/erp/pay/lookups/accounts'), 'accounts lookup');
    const pick = (code, re) => (accts.find(x => x.code === code) || accts.find(x => re.test(x.name)) || {}).code;
    const expenseAccount = pick('6100', /salar|wage|payroll/i), payableAccount = pick('2200', /accrued|payable/i);
    if (!expenseAccount || !payableAccount) { ws.shared.payAccountsMissing = true; return; }
    const data = { expenseAccount, payableAccount, deductionAccount: payableAccount };
    const cur = must(await a.get('/api/erp/pay/records/setting'), 'pay settings').find(x => x.code === 'defaults');
    if (cur) must(await a.put(`/api/erp/pay/records/setting/${cur.id}`, erp('setting', { code: 'defaults', data })), 'update pay defaults');
    else must(await a.post('/api/erp/pay/records/setting', erp('setting', { code: 'defaults', data })), 'create pay defaults');
    ws.shared.payAccounts = data;
  },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, ws = u.ws, admin = ws.admin;
    const PERIOD = ws.today.slice(0, 7);
    const [py, pm] = PERIOD.split('-').map(Number);
    const lastDay = new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10);          // last day of the pay period
    const nextFirst = addDays(lastDay, 1);
    const prevPeriod = new Date(Date.UTC(py, pm - 2, 1)).toISOString().slice(0, 7);
    const NO = p => `${p}-${K}`;
    const listPay = async (kind, qs = '') => must(await c.get(`/api/erp/pay/records/${kind}${qs}`), 'list ' + kind);
    const slipsOf = async run => (await listPay('payslip', '?take=5000')).filter(s => s.parent === run.id);
    const slipOf = (slips, p) => slips.find(s => s.data.empNo === NO(p));
    const emp = (p, basic, extra = {}) => ({ empNo: NO(p), fullName: `Pay ${p} ${K}`, email: `${p.toLowerCase()}.${K.toLowerCase()}@example.com`, unit: 'PAY', position: 'Staff', hireDate: '2024-01-01', status: 'Active', basicSalary: basic, company: ws.company || null, branch: ws.branch.RYD || null, ...extra });
    const HOUS = `HOUSING-${K}`, TRAN = `TRANSPORT-${K}`, GOSI = `GOSI-${K}`, MEAL = `MEAL-${K}`, OLD = `OLD-${K}`;

    // what the engine must produce for one employee, from the live element and adjustment lists
    const expected = async (basic, empNo, period) => {
      const els = (await listPay('element', '?status=Active')).filter(e => e.status === 'Active');
      const adj = (await listPay('adjustment')).filter(a => a.status !== 'Cancelled' && a.data.period === period && a.data.empNo === empNo);
      let gross = basic, ded = 0;
      for (const e of els) { const amt = e.data.calc === 'pctBasic' ? r2(basic * num(e.data.value) / 100) : num(e.data.value); if (!amt) continue; if (e.data.type === 'deduction') ded += amt; else gross += amt; }
      for (const a of adj) { const amt = num(a.data.amount); if (a.data.type === 'deduction') ded += amt; else gross += amt; }
      return { gross: r2(gross), ded: r2(ded), net: r2(gross - ded) };
    };

    await u.step('PAY-01', 'Pay elements: housing 25% and transport 10% of basic, meal 200 fixed, GOSI 12.1875% deduction; duplicate refused; inactive element listed but not active', async () => {
      const el = (code, name, type, calc, value, status = 'Active') => c.post('/api/erp/pay/records/element', erp('element', { code, status, data: { name, type, calc, value } }));
      must(await el(HOUS, 'Housing ' + K, 'earning', 'pctBasic', 25), 'housing');
      must(await el(TRAN, 'Transport ' + K, 'earning', 'pctBasic', 10), 'transport');
      must(await el(MEAL, 'Meal ' + K, 'earning', 'fixed', 200), 'meal');
      must(await el(GOSI, 'GOSI ' + K, 'deduction', 'pctBasic', 12.1875), 'gosi');
      must(await el(OLD, 'Old ' + K, 'earning', 'fixed', 999, 'Inactive'), 'inactive element');
      refused(await el(HOUS, 'dup', 'earning', 'fixed', 1), 'duplicate element', [409]);
      const l = await listPay('element');
      eq(l.find(e => e.code === GOSI).data.type, 'deduction', 'GOSI type'); eq(l.find(e => e.code === HOUS).data.value, 25, 'housing %');
      eq(l.find(e => e.code === OLD).status, 'Inactive', 'inactive status');
      ok((await listPay('element', '?status=Active')).filter(e => String(e.code).endsWith('-' + K)).length === 4, 'four active elements of mine');
      return '4 active elements + 1 inactive';
    });

    await u.step('PAY-02', 'Employees: main 10,000, self-service 6,000 (linked to its own login), late starter (last day of period), future starter (next month, must not be paid), terminated', async () => {
      const sname = `${u.username}s`;
      const mk = await admin.post('/api/users/admin', { username: sname, displayName: 'Self ' + K, email: `${sname}@example.com`, role: 'employee', password: PASSWORD, permissions: ws.roleDefaults.employee || [], isActive: true });
      must(mk, 'create self-service user');
      const sc = new Client(sname); await sc.login(sname, PASSWORD); S.self = sc; S.selfName = sname;
      must(await c.post('/api/hr/employees', emp('P', 10000)), 'main employee');
      must(await c.post('/api/hr/employees', emp('SELF', 6000, { username: sname })), 'self-service employee');
      must(await c.post('/api/hr/employees', emp('LATE', 4000, { hireDate: lastDay })), 'late starter');
      must(await c.post('/api/hr/employees', emp('FUT', 7000, { hireDate: nextFirst, status: 'Probation' })), 'future starter');
      must(await c.post('/api/hr/employees', emp('TERM', 5000, { status: 'Terminated', terminationDate: '2025-12-31' })), 'terminated');
      const l = must(await c.get('/api/hr/employees'), 'employees').filter(e => String(e.empNo).endsWith('-' + K));
      eq(l.length, 5, 'my employees'); eq(l.find(e => e.empNo === NO('FUT')).hireDate.slice(0, 10), nextFirst, 'future start date');
      return `period ${PERIOD} ends ${lastDay}; FUT starts ${nextFirst}`;
    });

    await u.step('PAY-03', 'Adjustments: bonus 500 and deduction 100 for the main employee; incomplete refused; a cancelled one is ignored', async () => {
      const adj = (empNo, amount, type, note) => c.post('/api/erp/pay/records/adjustment', erp('adjustment', { data: { period: PERIOD, empNo, amount, type, note } }));
      S.bonus = must(await adj(NO('P'), 500, 'earning', 'Bonus ' + K), 'bonus');
      must(await adj(NO('P'), 100, 'deduction', 'Loan ' + K), 'deduction');
      const x = must(await adj(NO('P'), 999, 'earning', 'Cancelled ' + K), 'to cancel');
      eq(must(await c.put(`/api/erp/pay/records/adjustment/${x.id}`, erp('adjustment', { status: 'Cancelled', data: x.data })), 'cancel').status, 'Cancelled', 'cancelled');
      refused(await c.post('/api/erp/pay/records/adjustment', erp('adjustment', { data: { period: PERIOD, amount: 5, type: 'earning' } })), 'adjustment without employee', [400]);
      refused(await c.post('/api/erp/pay/records/adjustment', erp('adjustment', { data: { empNo: NO('P'), amount: 5, type: 'earning' } })), 'adjustment without period', [400]);
      const mine = (await listPay('adjustment')).filter(a => a.data.empNo === NO('P'));
      eq(mine.length, 3, 'adjustments of the main employee'); ok(S.bonus.code, 'adjustment has no auto number');
      return 'bonus 500 + deduction 100 active, 999 cancelled';
    });

    await u.step('PAY-04', 'Run for the period: calculate; main slip = basic + 25% + 10% + 200 + 500 bonus, GOSI + 100; future starter and terminated not paid; gross = sum of payslips', async () => {
      const run = must(await c.post('/api/erp/pay/records/run', erp('run', { company: ws.company || null, data: { period: PERIOD, name: 'Payroll ' + K } })), 'create run');
      eq(run.status, 'Draft', 'new run'); ok(run.code, 'run has no number'); S.run = run;
      const calc = must(await c.post(`/api/erp/pay/runs/${run.id}/calculate`), 'calculate');
      eq(calc.status, 'Calculated', 'status'); S.calc = calc;
      const slips = await slipsOf(run); S.slips = slips;
      ok(slipOf(slips, 'P') && slipOf(slips, 'SELF') && slipOf(slips, 'LATE'), 'main, self-service and late-starter slips must exist');
      ok(!slipOf(slips, 'FUT'), 'DEFECT: employee starting ' + nextFirst + ' was paid for ' + PERIOD);
      ok(!slipOf(slips, 'TERM'), 'terminated employee was paid');
      eq(slips.filter(s => s.data.empNo === NO('P')).length, 1, 'one slip per employee');
      const p = slipOf(slips, 'P').data;
      const ex = await expected(10000, NO('P'), PERIOD);
      eq(p.gross, ex.gross, 'gross of main employee'); eq(p.totalDeductions, ex.ded, 'deductions of main employee'); eq(p.net, ex.net, 'net of main employee');
      const line = (arr, code) => (arr || []).find(x => x.code === code);
      eq(line(p.earnings, HOUS).amount, 2500, 'housing'); eq(line(p.earnings, TRAN).amount, 1000, 'transport'); eq(line(p.earnings, MEAL).amount, 200, 'meal');
      eq(line(p.deductions, GOSI).amount, 1218.75, 'GOSI'); ok(!line(p.earnings, OLD), 'inactive element was applied');
      ok((p.earnings || []).some(x => num(x.amount) === 500) && (p.deductions || []).some(x => num(x.amount) === 100), 'bonus 500 / loan 100 lines missing');
      ok(!(p.earnings || []).some(x => num(x.amount) === 999), 'cancelled adjustment applied');
      eq(slipOf(slips, 'LATE').data.basic, 4000, 'late starter paid');
      eq(r2(slips.reduce((a, s) => a + num(s.data.gross), 0)), calc.data.gross, 'run gross = sum of payslips');
      eq(r2(slips.reduce((a, s) => a + num(s.data.totalDeductions), 0)), calc.data.deductions, 'run deductions = sum of payslips');
      eq(r2(slips.reduce((a, s) => a + num(s.data.net), 0)), calc.data.net, 'run net = sum of payslips');
      eq(calc.data.count, slips.length, 'employee count');
      eq(r2(calc.data.gross - calc.data.deductions), calc.data.net, 'net = gross - deductions');
      return `${run.code}: main gross ${p.gross}, net ${p.net}; ${slips.length} slips (workspace), FUT/TERM absent`;
    });

    await u.step('PAY-05', 'Invalid runs: bad period cannot be calculated, approving before calculation refused, draft deleted', async () => {
      const r = must(await c.post('/api/erp/pay/records/run', erp('run', { company: ws.company || null, data: { period: 'bad', name: 'Bad ' + K } })), 'create bad run');
      refused(await c.post(`/api/erp/pay/runs/${r.id}/calculate`), 'calculate bad period', [400]);
      refused(await admin.post(`/api/erp/pay/runs/${r.id}/approve`), 'approve a draft', [400]);
      refused(await c.post('/api/erp/pay/records/run', erp('run', { status: 'Approved', data: { period: PERIOD } })), 'new run cannot start approved', [400]);
      refused(await c.post(`/api/erp/pay/runs/${r.id}/nonsense`), 'unknown action', [404]);
      ok((await c.del(`/api/erp/pay/records/run/${r.id}`)).status === 204, 'delete draft run');
      ok(!(await listPay('run')).some(x => x.id === r.id), 'deleted run still listed');
      return 'refused: calculate (400), approve draft (400), forged status (400)';
    });

    await u.step('PAY-06', 'Segregation of duties: the calculator can neither approve nor post', async () => {
      ok(S.run, 'depends on PAY-04');
      refused(await c.post(`/api/erp/pay/runs/${S.run.id}/approve`), 'calculator approves', [403]);
      refused(await c.post(`/api/erp/pay/runs/${S.run.id}/post`), 'calculator posts', [403]);
      refused(await admin.post(`/api/erp/pay/runs/${S.run.id}/post`), 'post before approval', [400]);
      return 'approve 403, post 403, post-before-approve 400';
    });

    await u.step('PAY-07', 'Recalculate after changing the bonus 500 -> 700: main gross +200, still one slip, run totals follow', async () => {
      ok(S.run && S.calc, 'depends on PAY-04');
      const before = num(slipOf(S.slips, 'P').data.gross);
      must(await c.put(`/api/erp/pay/records/adjustment/${S.bonus.id}`, erp('adjustment', { data: { ...S.bonus.data, amount: 700 } })), 'raise bonus');
      const calc = must(await c.post(`/api/erp/pay/runs/${S.run.id}/calculate`), 'recalculate');
      const slips = await slipsOf(S.run);
      eq(slips.filter(s => s.data.empNo === NO('P')).length, 1, 'slips of main employee after recalculation');
      eq(num(slipOf(slips, 'P').data.gross), before + 200, 'gross after bonus change');
      const ex = await expected(10000, NO('P'), PERIOD); eq(slipOf(slips, 'P').data.net, ex.net, 'net');
      eq(r2(slips.reduce((a, s) => a + num(s.data.gross), 0)), calc.data.gross, 'run gross = sum of payslips');
      S.calc = calc; S.slips = slips;
      return `gross ${before} -> ${before + 200}`;
    });

    await u.step('PAY-08', 'Approval by the admin (a different person): run and payslips Approved; recalculation and deletion then refused', async () => {
      ok(S.run, 'depends on PAY-04');
      const ap = must(await admin.post(`/api/erp/pay/runs/${S.run.id}/approve`), 'admin approves');
      eq(ap.status, 'Approved', 'run status'); eq(ap.data.approvedBy, admin.name, 'approvedBy'); eq(ap.data.calculatedBy, u.username, 'calculatedBy');
      const slips = await slipsOf(S.run);
      ok(slips.length > 0 && slips.every(s => s.status === 'Approved'), 'payslips are not all Approved');
      refused(await c.post(`/api/erp/pay/runs/${S.run.id}/calculate`), 'recalculate an approved run', [400]);
      refused(await c.del(`/api/erp/pay/records/run/${S.run.id}`), 'delete an approved run', [400]);
      refused(await admin.post(`/api/erp/pay/runs/${S.run.id}/approve`), 'approve twice', [400]);
      return 'Approved by ' + ap.data.approvedBy;
    });

    await u.step('PAY-09', 'Posting by the admin: run Posted, journal PAY-<run> debits gross and credits net + deductions; second post refused', async () => {
      ok(S.run, 'depends on PAY-04'); ok(!u.ws.shared.payAccountsMissing, 'payroll accounts could not be set up (no salary / accrued accounts in the chart)');
      const po = must(await admin.post(`/api/erp/pay/runs/${S.run.id}/post`), 'post');
      eq(po.status, 'Posted', 'run status'); eq(po.data.journal, 'PAY-' + S.run.code, 'journal code');
      const j = must(await admin.get('/api/finance/records/journal'), 'journals').find(x => x.code === 'PAY-' + S.run.code);
      ok(j, 'payroll journal not created');
      const lines = j.data.lines; const dr = r2(lines.reduce((a, l) => a + num(l.debit), 0)), cr = r2(lines.reduce((a, l) => a + num(l.credit), 0));
      eq(dr, po.data.gross, 'journal debit = run gross'); eq(cr, po.data.gross, 'journal credit = net + deductions = gross');
      eq(r2(lines.filter(l => num(l.credit) > 0).reduce((a, l) => a + num(l.credit), 0)), r2(num(po.data.net) + num(po.data.deductions)), 'credits = net + deductions');
      const slips = await slipsOf(S.run); ok(slips.every(s => s.status === 'Posted'), 'payslips are not all Posted');
      refused(await admin.post(`/api/erp/pay/runs/${S.run.id}/post`), 'post twice', [400]);
      return `journal ${j.code}: Dr ${dr} / Cr ${cr}`;
    });

    await u.step('PAY-10', 'Payslip self-service: the employee sees only the own slip with correct net; runs, other slips and edits refused', async () => {
      ok(S.self && S.run, 'depends on PAY-02 / PAY-04');
      const mine = must(await S.self.get('/api/erp/pay/records/payslip?take=5000'), 'own payslips');
      ok(mine.length >= 1 && mine.every(s => s.data.empNo === NO('SELF')), 'self-service user sees slips that are not hers: ' + mine.map(s => s.data.empNo).join(','));
      const slip = mine.find(s => s.parent === S.run.id); ok(slip, 'her slip of the run is missing');
      const ex = await expected(6000, NO('SELF'), PERIOD);
      eq(slip.data.gross, ex.gross, 'her gross'); eq(slip.data.net, ex.net, 'her net');
      ok(!mine.some(s => s.data.empNo === NO('P')), 'main employee slip leaked');
      refused(await S.self.get('/api/erp/pay/records/run'), 'runs for an employee', [403]);
      refused(await S.self.post(`/api/erp/pay/runs/${S.run.id}/calculate`), 'employee calculates', [403]);
      refused(await S.self.put(`/api/erp/pay/records/payslip/${slip.id}`, erp('payslip', { data: { net: 1 } })), 'employee edits her slip', [400, 403]);
      refused(await c.post('/api/erp/pay/records/payslip', erp('payslip', { data: { net: 1 } })), 'payslips are system-made', [400]);
      return `her net ${slip.data.net}`;
    });

    await u.step('PAY-11', 'Another period (previous month): bonus of this month not included, late starter not yet employed', async () => {
      const r2run = must(await c.post('/api/erp/pay/records/run', erp('run', { company: ws.company || null, data: { period: prevPeriod, name: 'Prior ' + K } })), 'create prior run');
      must(await c.post(`/api/erp/pay/runs/${r2run.id}/calculate`), 'calculate prior');
      const slips = await slipsOf(r2run);
      ok(slipOf(slips, 'P'), 'main slip in prior period'); ok(!slipOf(slips, 'LATE'), 'late starter paid before being hired'); ok(!slipOf(slips, 'FUT'), 'future starter paid');
      const ex = await expected(10000, NO('P'), prevPeriod);
      eq(slipOf(slips, 'P').data.net, ex.net, 'net without bonus');
      ok(!slipOf(slips, 'P').data.earnings.some(x => num(x.amount) === 700), 'bonus of another period applied');
      return `prior period ${prevPeriod}: main net ${slipOf(slips, 'P').data.net}`;
    });

    await u.step('PAY-12', 'Payroll overview: elements, open runs and last run numbers', async () => {
      const s = must(await c.get('/api/erp/pay/summary'), 'summary');
      const k = n => (s.kpis.find(x => x.k === n) || {}).v;
      ok(k('elements') >= 4, 'elements ' + k('elements')); ok(k('lastCount') >= 1, 'lastCount ' + k('lastCount')); ok(k('lastGross') > 0 && k('lastNet') > 0 && k('lastNet') < k('lastGross'), `last run gross ${k('lastGross')} net ${k('lastNet')}`);
      ok(k('openRuns') >= 1, 'openRuns (the prior-period run is still Calculated)');
      ok(s.lists.some(l => l.k === 'netByPeriod' && l.rows.some(r => r.name === PERIOD)), 'net-by-period lacks ' + PERIOD);
      return `elements ${k('elements')}, open runs ${k('openRuns')}, last net ${k('lastNet')}`;
    });
  },
};
