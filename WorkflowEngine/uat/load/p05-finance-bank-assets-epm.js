// Finance - bank accounts and reconciliation, budgets vs actual, fixed assets with depreciation and disposal, finance project, EPM (plan, forecast, publish, variance), VAT / trial balance / P&L reports.
const { refused } = require('../lib');
const { must, eq, ok, toNum, r2, eom, ACC, flist, fcreate, fput, fputOk, byId, journal, net, bankAccount, bankBalance } = require('./_fin');

module.exports = {
  id: 'finance-bank-assets-epm',
  title: 'Treasury, assets and planning accountant',
  modules: ['finance', 'epm'],
  role: 'finance',
  perms: ['finance.*', 'epm.*', 'cal.*'],
  probe: { path: '/api/finance/records/bankaccount', perm: 'finance.bank.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company, today = u.ws.today, year = Number(today.slice(0, 4));
    const A = `BKA-${K}`, B = `BKB-${K}`, CCB = `CCB-${K}`, CCE = `CCE-${K}`;
    const summary = async () => must(await c.get('/api/finance/summary'), 'summary');
    const budgetRow = (s, name) => (s.budgetRows || []).find(r => r.name === name);
    const expense = (amount, cc, ref, account = ACC.office) => journal(c, CO, { date: today, memo: ref, reference: ref, lines: [{ account, debit: amount, costCenter: cc }, { account: ACC.cash, credit: amount }] });
    const txn = (account, amount, description, reference) => fcreate(c, 'banktxn', { company: CO, status: 'Active', data: { account, date: today, amount, description, reference, reconciled: false } });

    // ------------------------------------------------------------ bank
    await u.step('BK-01', 'Bank accounts: two active (opening 10,000.00 and 0) and one inactive; duplicate / missing code refused; update; CFO cash lists active ones only', async () => {
      S.a = await bankAccount(c, CO, A, 'Main ' + K, 10000); S.b = await bankAccount(c, CO, B, 'Second ' + K, 0);
      await fcreate(c, 'bankaccount', { code: `BKC-${K}`, company: CO, status: 'Inactive', data: { name: 'Closed ' + K, bankName: 'x', currency: 'SAR', glAccount: ACC.bank, openingBalance: 777 } });
      refused(await c.post('/api/finance/records/bankaccount', { code: A, company: CO, status: 'Active', data: { name: 'dup' } }), 'duplicate bank account', [409]);
      refused(await c.post('/api/finance/records/bankaccount', { company: CO, status: 'Active', data: { name: 'no code' } }), 'bank account without code', [400]);
      S.a = await fputOk(c, 'bankaccount', S.a, { data: { bankName: 'Updated bank ' + K } }); eq(S.a.data.bankName, 'Updated bank ' + K, 'bank name');
      const s = await summary();
      const row = s.cashByAccount.find(x => x.name === 'Main ' + K); ok(row, 'Main account not in cash by account'); eq(row.value, 10000, 'opening balance');
      ok(!s.cashByAccount.some(x => x.name === 'Closed ' + K), 'inactive account must not count as cash');
      return 'Main 10,000.00; inactive excluded';
    });

    await u.step('BK-02', 'Bank lines: deposit +5,000.00, payment -1,200.00, charge -35.50 give balance 13,764.50 (also in the CFO cash figure)', async () => {
      ok(S.a, 'depends on BK-01');
      S.t1 = await txn(A, 5000, 'Customer deposit', 'DEP-' + K); S.t2 = await txn(A, -1200, 'Supplier payment', 'PAY-' + K); S.t3 = await txn(A, -35.5, 'Bank charge', 'CHG-' + K);
      eq(await bankBalance(c, S.a), 13764.5, 'book balance');
      const row = (await summary()).cashByAccount.find(x => x.name === 'Main ' + K); eq(row.value, 13764.5, 'CFO cash by account');
      eq((await flist(c, 'banktxn')).filter(t => t.data.account === A).length, 3, 'bank lines');
      return 'balance 13,764.50';
    });

    await u.step('BK-03', 'Reconciliation: statement 13,764.50; tick deposit and payment -> unreconciled difference 35.50 (the charge); tick the charge -> difference 0', async () => {
      ok(S.t1 && S.t2 && S.t3, 'depends on BK-02');
      const statement = 13764.5;
      const diff = async () => { const tx = (await flist(c, 'banktxn')).filter(t => t.data.account === A); const rec = tx.filter(t => t.data.reconciled === true).reduce((s, t) => s + toNum(t.data.amount), 0); return r2(statement - (toNum(S.a.data.openingBalance) + rec)); };
      eq(await diff(), 13764.5 - 10000, 'nothing reconciled yet: difference is all movements');
      await fputOk(c, 'banktxn', S.t1, { data: { reconciled: true } }); await fputOk(c, 'banktxn', S.t2, { data: { reconciled: true } });
      eq(await diff(), -35.5, 'difference with charge open');
      return 'difference -35.50 before the charge is ticked';
    });

    await u.step('BK-04', 'Reconciliation closes: charge ticked -> difference 0; account stamped; unticking restores the difference', async () => {
      ok(S.t3, 'depends on BK-02');
      const t3 = await fputOk(c, 'banktxn', S.t3, { data: { reconciled: true } }); eq(t3.data.reconciled, true, 'ticked');
      const tx = (await flist(c, 'banktxn')).filter(t => t.data.account === A); ok(tx.every(t => t.data.reconciled === true), 'all lines reconciled');
      eq(r2(13764.5 - (10000 + tx.reduce((s, t) => s + toNum(t.data.amount), 0))), 0, 'difference');
      S.a = await fputOk(c, 'bankaccount', S.a, { data: { lastReconciled: today, statementBalance: 13764.5 } }); eq(S.a.data.statementBalance, 13764.5, 'stamp');
      const back = await fputOk(c, 'banktxn', t3, { data: { reconciled: false } }); eq(back.data.reconciled, false, 'unticked');
      await fputOk(c, 'banktxn', back, { data: { reconciled: true } });
      return 'reconciled, difference 0';
    });

    await u.step('BK-05', 'Transfer 2,000.00 between my accounts (out of Main, into Second) keeps total cash; bank charge booked to the GL (Dr 6800 / Cr 1020 35.50)', async () => {
      ok(S.a && S.b, 'depends on BK-01');
      await txn(A, -2000, 'Transfer out', 'TRF-' + K); await txn(B, 2000, 'Transfer in', 'TRF-' + K);
      const ba = await bankBalance(c, S.a), bb = await bankBalance(c, S.b);
      eq(ba, 11764.5, 'Main after transfer'); eq(bb, 2000, 'Second after transfer'); eq(r2(ba + bb), 13764.5, 'total cash unchanged');
      const j = await journal(c, CO, { date: today, memo: 'Bank charge ' + K, reference: `CHG-${K}`, lines: [{ account: '6800', debit: 35.5 }, { account: ACC.bank, credit: 35.5 }] });
      eq(net([j]).of('6800'), 35.5, 'Dr bank charges'); eq(net([j]).of(ACC.bank), -35.5, 'Cr bank');
      const s = await summary(); eq(s.cashByAccount.find(x => x.name === 'Second ' + K).value, 2000, 'CFO cash Second');
      return 'Main 11,764.50 + Second 2,000.00 = 13,764.50';
    });

    // ------------------------------------------------------------ budgets
    await u.step('BG-01', 'Budget 10,000.00 on my cost centre and account 6500; expense 2,500.00 posted -> actual 2,500.00, used 25%, left 7,500.00', async () => {
      await fcreate(c, 'costcenter', { code: CCB, status: 'Active', data: { name: 'Budget CC ' + K } });
      S.bud = await fcreate(c, 'budget', { company: CO, status: 'Active', data: { year, costCenter: CCB, account: ACC.office, amount: 10000, notes: 'Budget ' + K } });
      await expense(2500, CCB, `BUD1-${K}`);
      const row = budgetRow(await summary(), `${CCB} / ${ACC.office}`); ok(row, 'budget row missing from the CFO summary');
      eq(row.budget, 10000, 'budget'); eq(row.actual, 2500, 'actual'); eq(r2(row.actual / row.budget * 100), 25, 'used %'); eq(r2(row.budget - row.actual), 7500, 'left');
      return 'actual 2,500 of 10,000';
    });

    await u.step('BG-02', 'Over budget: another 9,000.00 -> actual 11,500.00 (1,500.00 over); raising the budget to 12,000.00 leaves 500.00; a spare budget can be deleted', async () => {
      ok(S.bud, 'depends on BG-01');
      await expense(9000, CCB, `BUD2-${K}`);
      let row = budgetRow(await summary(), `${CCB} / ${ACC.office}`); eq(row.actual, 11500, 'actual'); eq(r2(row.budget - row.actual), -1500, 'over by');
      await fputOk(c, 'budget', S.bud, { data: { amount: 12000 } });
      row = budgetRow(await summary(), `${CCB} / ${ACC.office}`); eq(row.budget, 12000, 'new budget'); eq(r2(row.budget - row.actual), 500, 'left');
      const sp = await fcreate(c, 'budget', { company: CO, status: 'Active', data: { year, costCenter: CCB, account: '6300', amount: 1, notes: 'spare ' + K } });
      must(await c.del(`/api/finance/records/budget/${sp.id}`), 'delete spare budget');
      return 'over by 1,500, then left 500';
    });

    // ------------------------------------------------------------ fixed assets
    await u.step('FA-01', 'Asset class and asset FA: cost 36,000.00, salvage 6,000.00, 60 months -> monthly depreciation 500.00; duplicate / missing code refused; acquisition journal', async () => {
      await fcreate(c, 'assetclass', { code: `CLS-${K}`, status: 'Active', data: { name: 'Class ' + K, lifeMonths: 60, method: 'SL' } });
      refused(await c.post('/api/finance/records/assetclass', { code: `CLS-${K}`, status: 'Active', data: {} }), 'duplicate class', [409]);
      S.fa = await fcreate(c, 'asset', { code: `FA-${K}`, company: CO, status: 'Active', data: { name: 'Machine ' + K, class: `CLS-${K}`, cost: 36000, salvage: 6000, lifeMonths: 60, method: 'SL', inServiceDate: `${year}-01-01`, accumulated: 0, location: 'Riyadh' } });
      refused(await c.post('/api/finance/records/asset', { code: `FA-${K}`, company: CO, status: 'Active', data: {} }), 'duplicate asset', [409]);
      refused(await c.post('/api/finance/records/asset', { company: CO, status: 'Active', data: { name: 'no code' } }), 'asset without code', [400]);
      eq(r2((36000 - 6000) / 60), 500, 'monthly depreciation'); eq(500 * 60, 36000 - 6000, 'fully depreciated at end of life');
      const j = await journal(c, CO, { date: today, memo: 'Acquisition ' + K, reference: `ACQ-${K}`, lines: [{ account: ACC.fa, debit: 36000 }, { account: ACC.bank, credit: 36000 }] });
      eq(j.status, 'Posted', 'acquisition posted');
      return 'monthly 500.00';
    });

    await u.step('FA-02', 'Depreciation Jan-Mar: three journals Dr 6600 / Cr 1590 500.00 each; accumulated 1,500.00, net book value 34,500.00; CFO asset totals include it', async () => {
      ok(S.fa, 'depends on FA-01');
      for (const m of ['01', '02', '03']) await journal(c, CO, { date: eom(`${year}-${m}-01`), memo: `Depreciation ${year}-${m}`, reference: `DEPR-${K}-${m}`, lines: [{ account: ACC.dep, debit: 500 }, { account: ACC.accDep, credit: 500 }] });
      const upd = await fputOk(c, 'asset', S.fa, { data: { accumulated: 1500, lastPeriod: `${year}-03` } }); S.fa = upd;
      eq(upd.data.accumulated, 1500, 'accumulated'); eq(r2(36000 - upd.data.accumulated), 34500, 'net book value');
      const mine = (await flist(c, 'journal', '?status=Posted')).filter(j => String(j.data.reference).startsWith(`DEPR-${K}`));
      eq(mine.length, 3, 'depreciation journals'); eq(net(mine).of(ACC.dep), 1500, 'Dr depreciation expense'); eq(net(mine).of(ACC.accDep), -1500, 'Cr accumulated depreciation');
      const s = await summary(); ok(s.assetCount >= 1 && s.assetCost >= 36000 && s.assetAccumulated >= 1500, `asset totals ${s.assetCount} / ${s.assetCost} / ${s.assetAccumulated}`);
      return 'NBV 34,500.00';
    });

    await u.step('FA-03', 'Disposal for 33,000.00: Dr cash 33,000 + Dr accumulated 1,500 + Dr loss 1,500 / Cr asset cost 36,000; asset Disposed; asset accounts net to zero', async () => {
      ok(S.fa && S.fa.data.accumulated === 1500, 'depends on FA-02');
      const nbv = r2(36000 - S.fa.data.accumulated), proceeds = 33000, loss = r2(nbv - proceeds); eq(loss, 1500, 'loss on disposal');
      await journal(c, CO, { date: today, memo: 'Disposal ' + K, reference: `DISP-${K}`, lines: [{ account: ACC.cash, debit: proceeds }, { account: ACC.accDep, debit: 1500 }, { account: ACC.office, debit: loss }, { account: ACC.fa, credit: 36000 }] });
      const d = await fputOk(c, 'asset', S.fa, { status: 'Disposed', data: { disposedDate: today, proceeds } }); eq(d.status, 'Disposed', 'status');
      const mine = (await flist(c, 'journal', '?status=Posted')).filter(j => /^(ACQ|DEPR|DISP)-/.test(String(j.data.reference)) && String(j.data.reference).includes(K));
      const t = net(mine); eq(t.of(ACC.fa), 0, 'asset cost nets to 0'); eq(t.of(ACC.accDep), 0, 'accumulated nets to 0'); eq(t.of(ACC.office), 1500, 'loss'); eq(t.dr, t.cr, 'balanced');
      return 'loss 1,500.00; asset Disposed';
    });

    // ------------------------------------------------------------ finance project
    await u.step('PJ-01', 'Finance project: create, duplicate refused, update, Active count in the CFO summary, close', async () => {
      const code = `PRJ-${K}`;
      const p = await fcreate(c, 'project', { code, company: CO, status: 'Active', data: { name: 'Project ' + K, budget: 50000, start: today } });
      refused(await c.post('/api/finance/records/project', { code, company: CO, status: 'Active', data: {} }), 'duplicate project', [409]);
      const up = await fputOk(c, 'project', p, { data: { budget: 60000 } }); eq(up.data.budget, 60000, 'budget');
      ok((await summary()).activeProjects >= 1, 'activeProjects');
      const cl = await fputOk(c, 'project', up, { status: 'Closed' }); eq(cl.status, 'Closed', 'closed');
      return code + ' closed';
    });

    // ------------------------------------------------------------ EPM
    await u.step('EPM-01', 'EPM plan: Draft, four lines (1,000 + 1,500 on 6500, 800 on 6200 ...) total 3,300.00; invalid lines and early publish refused', async () => {
      await fcreate(c, 'costcenter', { code: CCE, status: 'Active', data: { name: 'EPM CC ' + K } });
      S.plan = must(await c.post('/api/erp/epm/records/plan', { company: CO, data: { name: `Plan ${K}`, year: String(year), scenario: 'Base', version: 'v1' } }), 'create plan');
      eq(S.plan.status, 'Draft', 'status'); ok(/^BP-\d{4}-\d{4}$/.test(S.plan.code), 'plan number ' + S.plan.code);
      for (const [acc, amt] of [[ACC.office, 1000], [ACC.office, 1500], [ACC.rent, 500], [ACC.rent, 300]])
        must(await c.post('/api/erp/epm/records/line', { company: CO, ref: S.plan.code, data: { costCenter: CCE, account: acc, amount: amt, note: 'line ' + K } }), 'plan line');
      const lines = must(await c.get(`/api/erp/epm/records/line?ref=${S.plan.code}`), 'plan lines'); eq(lines.length, 4, 'lines');
      eq(r2(lines.reduce((s, l) => s + toNum(l.data.amount), 0)), 3300, 'plan total');
      refused(await c.post('/api/erp/epm/records/line', { company: CO, data: { costCenter: CCE, account: ACC.office, amount: 5 } }), 'line without plan', [400]);
      refused(await c.post('/api/erp/epm/records/line', { company: CO, ref: S.plan.code, data: { costCenter: CCE, account: ACC.office, amount: -5 } }), 'negative line', [400]);
      refused(await c.post(`/api/erp/epm/plans/${S.plan.id}/publish`, {}), 'publish before approval', [400]);
      refused(await c.put(`/api/erp/epm/records/plan/${S.plan.id}`, { status: 'Published', data: S.plan.data }), 'set Published by hand', [400]);
      return S.plan.code + ' total 3,300.00';
    });

    await u.step('EPM-02', 'Approve (once), publish to Finance budgets: 2 budget rows 2,500.00 (6500) and 800.00 (6200); second publish and delete refused; empty plan cannot be published', async () => {
      ok(S.plan, 'depends on EPM-01');
      const ap = must(await c.post(`/api/erp/epm/plans/${S.plan.id}/approve`, {}), 'approve'); eq(ap.status, 'Approved', 'approved'); ok(String(ap.data.approvedBy).toLowerCase() === u.username.toLowerCase(), 'approvedBy ' + ap.data.approvedBy);
      refused(await c.post(`/api/erp/epm/plans/${S.plan.id}/approve`, {}), 'approve twice', [400]);
      const pub = must(await c.post(`/api/erp/epm/plans/${S.plan.id}/publish`, {}), 'publish'); eq(pub.status, 'Published', 'published');
      const bud = (await flist(c, 'budget')).filter(b => b.data.plan === S.plan.code); eq(bud.length, 2, 'budget rows');
      eq(bud.find(b => b.data.account === ACC.office).data.amount, 2500, 'budget 6500'); eq(bud.find(b => b.data.account === ACC.rent).data.amount, 800, 'budget 6200');
      eq(r2(bud.reduce((s, b) => s + toNum(b.data.amount), 0)), 3300, 'published total');
      refused(await c.post(`/api/erp/epm/plans/${S.plan.id}/publish`, {}), 'publish twice', [400]);
      refused(await c.del(`/api/erp/epm/records/plan/${S.plan.id}`), 'delete published plan', [400]);
      const p2 = must(await c.post('/api/erp/epm/records/plan', { company: CO, data: { name: `Empty ${K}`, year: String(year), scenario: 'Base', version: 'v1' } }), 'second plan');
      must(await c.post(`/api/erp/epm/plans/${p2.id}/approve`, {}), 'approve empty'); refused(await c.post(`/api/erp/epm/plans/${p2.id}/publish`, {}), 'publish empty plan', [400]);
      must(await c.del(`/api/erp/epm/records/plan/${p2.id}`), 'delete empty plan');
      return 'published, 2 budgets, 3,300.00';
    });

    await u.step('EPM-03', 'Forecast: three periods 1,000 / 1,100 / 900, change the second to 1,300 -> total 3,200.00; plan total unchanged; forecast approved', async () => {
      ok(S.plan, 'depends on EPM-01');
      const f = [];
      for (const [m, amt] of [['01', 1000], ['02', 1100], ['03', 900]]) f.push(must(await c.post('/api/erp/epm/records/forecast', { company: CO, data: { period: `${year}-${m}`, costCenter: CCE, account: ACC.office, amount: amt, basis: 'trend ' + K } }), 'forecast ' + m));
      eq(f[0].status, 'Draft', 'forecast status');
      must(await c.put(`/api/erp/epm/records/forecast/${f[1].id}`, { status: f[1].status, data: Object.assign({}, f[1].data, { amount: 1300 }) }), 'change forecast');
      const mine = must(await c.get('/api/erp/epm/records/forecast'), 'forecasts').filter(x => x.data.costCenter === CCE);
      eq(mine.length, 3, 'forecast rows'); eq(r2(mine.reduce((s, x) => s + toNum(x.data.amount), 0)), 3200, 'forecast total');
      const lines = must(await c.get(`/api/erp/epm/records/line?ref=${S.plan.code}`), 'lines'); eq(r2(lines.reduce((s, l) => s + toNum(l.data.amount), 0)), 3300, 'plan total unchanged');
      const ap = must(await c.put(`/api/erp/epm/records/forecast/${f[0].id}`, { status: 'Approved', data: f[0].data }), 'approve forecast'); eq(ap.status, 'Approved', 'forecast approved');
      return 'forecast 3,200.00 vs plan 3,300.00';
    });

    await u.step('EPM-04', 'Variance: published budget 2,500.00 (6500) vs actual 1,800.00 -> +700.00 under; after 1,000.00 more -> -300.00 over; the 800.00 rent budget is untouched', async () => {
      ok(S.plan && S.plan.status, 'depends on EPM-01/02');
      await expense(1800, CCE, `EPM1-${K}`);
      let s = await summary(); let row = budgetRow(s, `${CCE} / ${ACC.office}`); ok(row, 'published budget row missing'); eq(row.budget, 2500, 'budget'); eq(row.actual, 1800, 'actual'); eq(r2(row.budget - row.actual), 700, 'variance');
      await expense(1000, CCE, `EPM2-${K}`);
      s = await summary(); row = budgetRow(s, `${CCE} / ${ACC.office}`); eq(row.actual, 2800, 'actual 2'); eq(r2(row.budget - row.actual), -300, 'variance 2'); eq(r2(-300 / 2500 * 100), -12, 'variance %');
      const rent = budgetRow(s, `${CCE} / ${ACC.rent}`); ok(rent, 'rent row'); eq(rent.budget, 800, 'rent budget'); eq(rent.actual, 0, 'rent actual');
      return 'variance +700 then -300';
    });

    await u.step('EPM-05', 'EPM module summary: plans, approved, plan total and forecast total include mine; BI/insight access follows the privilege', async () => {
      const s = must(await c.get('/api/erp/epm/summary'), 'epm summary');
      const k = n => { const x = (s.kpis || []).find(y => y.k === n); ok(x, 'kpi ' + n); return x.v; };
      ok(k('plans') >= 1 && k('approved') >= 1, 'plans / approved'); ok(k('planTotal') >= 3300, 'planTotal ' + k('planTotal')); ok(k('forecastTotal') >= 3200, 'forecastTotal ' + k('forecastTotal'));
      ok((s.lists || []).some(l => l.k === 'plansByStatus'), 'plansByStatus list');
      return `plans ${k('plans')}, plan total ${k('planTotal')}`;
    });

    // ------------------------------------------------------------ reports
    await u.step('RP-01', 'Reports on my journals: VAT payable 90.00 (150.00 out - 60.00 in), profit 600.00, trial balance of all posted journals balances', async () => {
      await journal(c, CO, { date: today, memo: 'Sale ' + K, reference: `VAT-${K}-S`, lines: [{ account: ACC.cash, debit: 1150 }, { account: ACC.sales, credit: 1000 }, { account: ACC.vatOut, credit: 150 }] });
      await journal(c, CO, { date: today, memo: 'Purchase ' + K, reference: `VAT-${K}-P`, lines: [{ account: '6300', debit: 400 }, { account: ACC.vatIn, debit: 60 }, { account: ACC.cash, credit: 460 }] });
      const posted = await flist(c, 'journal', '?status=Posted');
      const mine = posted.filter(j => String(j.data.reference).startsWith(`VAT-${K}`)); eq(mine.length, 2, 'my VAT journals');
      const t = net(mine);
      eq(r2(-t.of(ACC.vatOut)), 150, 'VAT output'); eq(t.of(ACC.vatIn), 60, 'VAT input'); eq(r2(-t.of(ACC.vatOut) - t.of(ACC.vatIn)), 90, 'VAT payable');
      const types = {}; for (const a of await flist(c, 'account')) types[a.code] = a.data.type;
      const revenue = r2(-Object.keys(t.by).filter(k => types[k] === 'Revenue').reduce((s, k) => s + t.of(k), 0)), exp = r2(Object.keys(t.by).filter(k => types[k] === 'Expense').reduce((s, k) => s + t.of(k), 0));
      eq(revenue, 1000, 'revenue'); eq(exp, 400, 'expense'); eq(r2(revenue - exp), 600, 'profit');
      const all = net(posted); eq(all.dr, all.cr, 'trial balance debits = credits');
      const s = await summary(); eq(r2(s.revenueYtd - s.expenseYtd), s.profitYtd, 'CFO profit = revenue - expense');
      return 'VAT payable 90.00; profit 600.00; TB ' + all.dr;
    });
  }
};
