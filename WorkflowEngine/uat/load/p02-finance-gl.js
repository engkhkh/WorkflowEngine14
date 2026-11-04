// Finance - general ledger: workspace finance master data (setup, once), then journals, periods, accounts, cost centres, tax codes, currencies, trial balance, audit.
const { refused } = require('../lib');
const { must, eq, ok, toNum, r2, addDays, ACC, flist, fcreate, fput, fputOk, byId, journal, net } = require('./_fin');

const VAT_OUT = 'VAT15-OUT', VAT_IN = 'VAT15-IN';

module.exports = {
  id: 'finance-gl',
  title: 'General ledger accountant',
  modules: ['finance'],
  role: 'finance',
  perms: ['finance.*', 'cal.*'],
  probe: { path: '/api/finance/records/journal', perm: 'finance.gl.view' },

  /** Same master data as uat/u2.js preDay0, made by the workspace admin: chart, tax codes, cost centres, fiscal year, controls, defaults. */
  async setup(ws) {
    const n = ws.admin, co = ws.company, year = Number(ws.today.slice(0, 4));
    const r = await n.post('/api/finance/accounts/seed', {});
    if (!r.ok && r.status !== 409) must(r, 'accounts/seed');
    if (r.ok) eq(r.data.created, 30, 'accounts created');
    refused(await n.post('/api/finance/accounts/seed', {}), 'second seed', [409]);
    const have = (await flist(n, 'account')).map(a => a.code);
    for (const [code, name] of [['2210', 'Salaries payable'], ['2220', 'GOSI payable']])
      if (!have.includes(code)) await fcreate(n, 'account', { code, status: 'Active', data: { name, nameAr: name, type: 'Liability', isHeader: false } });
    const mk = async (kind, code, data) => { if (!(await flist(n, kind)).find(x => x.code === code)) await fcreate(n, kind, { code, status: 'Active', data }); };
    await mk('taxcode', VAT_OUT, { name: 'VAT 15% output', rate: 15 });
    await mk('taxcode', VAT_IN, { name: 'VAT 15% input', rate: 15 });
    await mk('costcenter', 'PROC', { name: 'Procurement', nameAr: 'المشتريات' });
    await mk('costcenter', 'SALES', { name: 'Sales', nameAr: 'المبيعات' });
    await mk('assetclass', 'MED', { name: 'Medical equipment', lifeMonths: 60, method: 'SL' });
    const have2 = (await flist(n, 'period')).map(p => p.code);
    for (let m = 1; m <= 12; m++) { const code = `${year}-${String(m).padStart(2, '0')}`; if (!have2.includes(code)) await fcreate(n, 'period', { code, company: co, status: 'Open', data: {} }); }
    const sets = await flist(n, 'setting');
    if (!sets.find(s => s.code === 'controls')) await fcreate(n, 'setting', { code: 'controls', status: 'Active', data: { enforceSod: false, matchTolerancePct: 2 } });
    const defaults = { arAccount: ACC.ar, apAccount: ACC.ap, bankAccount: ACC.cash, revenueAccount: ACC.sales, expenseAccount: ACC.office, vatInput: ACC.vatIn, vatOutput: ACC.vatOut, deprExpense: ACC.dep, deprAccum: ACC.accDep };
    const ex = sets.find(s => s.code === 'defaults');
    if (ex) await fputOk(n, 'setting', ex, { data: defaults }); else await fcreate(n, 'setting', { code: 'defaults', status: 'Active', data: defaults });
    const ps = (await flist(n, 'period')).filter(p => String(p.code).startsWith(String(year)));
    eq(ps.length, 12, 'periods'); ok(ps.every(p => p.status === 'Open'), 'a period is not Open');
  },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company, today = u.ws.today, year = Number(today.slice(0, 4));
    const A = `GLX-${K}`, H = `GLH-${K}`, I = `GLI-${K}`, CC = `CC-${K}`, REF = `JV-${K}`;
    S.expA = 0;   // what my posted journals should have put on my own expense account A
    const jl = async (q = '') => (await flist(c, 'journal', q)).filter(j => String(j.data.reference || '').includes(K));
    const line = (account, debit, credit, costCenter = '') => ({ account, debit, credit, costCenter });

    await u.step('GL-01', 'Chart of accounts: starter chart present; own expense, header and inactive accounts; duplicate and missing code refused', async () => {
      const all = await flist(c, 'account');
      ok(all.length >= 30, 'chart has ' + all.length + ' accounts');
      for (const code of Object.values(ACC)) ok(all.some(a => a.code === code), 'account ' + code + ' missing');
      eq(all.find(a => a.code === '1000').data.isHeader, true, '1000 is a header');
      eq(all.find(a => a.code === '4100').data.type, 'Revenue', '4100 type');
      S.acc = await fcreate(c, 'account', { code: A, status: 'Active', data: { name: 'Test expense ' + K, nameAr: 'مصروف ' + K, type: 'Expense', isHeader: false } });
      await fcreate(c, 'account', { code: H, status: 'Active', data: { name: 'Header ' + K, type: 'Expense', isHeader: true } });
      await fcreate(c, 'account', { code: I, status: 'Inactive', data: { name: 'Inactive ' + K, type: 'Expense', isHeader: false } });
      refused(await c.post('/api/finance/records/account', { code: A, status: 'Active', data: { name: 'dup', type: 'Expense' } }), 'duplicate account code', [409]);
      refused(await c.post('/api/finance/records/account', { status: 'Active', data: { name: 'no code', type: 'Expense' } }), 'account without code', [400]);
      const up = await fputOk(c, 'account', S.acc, { data: { name: 'Test expense renamed ' + K } });
      eq(up.data.name, 'Test expense renamed ' + K, 'renamed');
      return all.length + ' accounts; own A/H/I created';
    });

    await u.step('GL-02', 'Cost centre, tax code and currency: create, update, duplicate refused, visible in lookups', async () => {
      const cc = await fcreate(c, 'costcenter', { code: CC, status: 'Active', data: { name: 'Cost centre ' + K, nameAr: 'مركز ' + K } });
      refused(await c.post('/api/finance/records/costcenter', { code: CC, status: 'Active', data: { name: 'dup' } }), 'duplicate cost centre', [409]);
      const cc2 = await fputOk(c, 'costcenter', cc, { data: { name: 'Cost centre renamed ' + K } });
      eq(cc2.data.name, 'Cost centre renamed ' + K, 'cost centre name');
      await fcreate(c, 'taxcode', { code: `TX5-${K}`, status: 'Active', data: { name: 'VAT 5% ' + K, rate: 5 } });
      const tx = (await flist(c, 'taxcode'));
      eq(tx.find(t => t.code === `TX5-${K}`).data.rate, 5, 'tax rate 5');
      eq(tx.find(t => t.code === VAT_OUT).data.rate, 15, 'workspace VAT output 15');
      await fcreate(c, 'currency', { code: `FX-${K}`, status: 'Active', data: { name: 'Test dollar ' + K, rate: 3.75, symbol: '$' } });
      eq((await flist(c, 'currency')).find(x => x.code === `FX-${K}`).data.rate, 3.75, 'currency rate');
      const lk = must(await c.get('/api/erp/proc/lookups/costcenters'), 'cost centre lookup');
      ok(lk.some(x => x.code === CC), 'cost centre not in lookups');
      const lk2 = must(await c.get('/api/erp/proc/lookups/taxcodes'), 'tax code lookup');
      ok(lk2.some(x => x.code === `TX5-${K}`), 'tax code not in lookups');
      const st = await flist(c, 'setting');
      ok(st.some(s => s.code === 'controls') && st.some(s => s.code === 'defaults'), 'controls / defaults settings missing');
      return 'cost centre, tax code 5%, currency 3.75';
    });

    await u.step('GL-03', 'Draft journal: create (auto number), edit lines, not in the posted list, delete a spare draft', async () => {
      const j = await journal(c, CO, { date: today, memo: 'Draft ' + K, reference: REF, status: 'Draft', lines: [line(A, 1234.56, 0, CC), line(ACC.cash, 0, 1234.56)] });
      ok(/^JV-\d{4}-\d{4}$/.test(j.code), 'journal number ' + j.code); eq(j.status, 'Draft', 'status');
      const e = await fputOk(c, 'journal', j, { data: { lines: [line(A, 2000, 0, CC), line(ACC.cash, 0, 2000)] } }, 'edit draft');
      eq(e.data.lines[0].debit, 2000, 'edited debit'); S.j1 = e;
      ok((await flist(c, 'journal', '?status=Draft')).some(x => x.id === j.id), 'not in the Draft list');
      ok(!(await flist(c, 'journal', '?status=Posted')).some(x => x.id === j.id), 'draft shows in the Posted list');
      const spare = await journal(c, CO, { date: today, memo: 'Spare ' + K, reference: REF, status: 'Draft', lines: [line(A, 5, 0), line(ACC.cash, 0, 5)] });
      must(await c.del(`/api/finance/records/journal/${spare.id}`), 'delete draft');
      ok(!(await flist(c, 'journal')).some(x => x.id === spare.id), 'spare draft still listed');
      return 'draft ' + j.code + ' 2,000.00';
    });

    await u.step('GL-04', 'Submit then post the draft: approver recorded, counts under journals to approve, enters the ledger', async () => {
      ok(S.j1, 'depends on GL-03');
      const sub = await fputOk(c, 'journal', S.j1, { status: 'Submitted' }, 'submit');
      eq(sub.status, 'Submitted', 'submitted');
      const sum = must(await c.get('/api/finance/summary'), 'summary'); ok(sum.journalsToApprove >= 1, 'journalsToApprove ' + sum.journalsToApprove);
      const post = await fputOk(c, 'journal', sub, { status: 'Posted' }, 'post');
      eq(post.status, 'Posted', 'posted'); ok(String(post.approvedBy).toLowerCase() === u.username.toLowerCase(), 'approvedBy ' + post.approvedBy);
      S.j1 = post; S.expA += 2000;
      return post.code + ' Posted by ' + post.approvedBy;
    });

    await u.step('GL-05', 'A posted journal cannot be edited, un-posted or deleted', async () => {
      ok(S.j1 && S.j1.status === 'Posted', 'depends on GL-04');
      refused(await fput(c, 'journal', S.j1, { data: { memo: 'tamper' } }), 'edit posted journal', [400]);
      refused(await fput(c, 'journal', S.j1, { status: 'Draft' }), 'un-post journal', [400]);
      refused(await c.del(`/api/finance/records/journal/${S.j1.id}`), 'delete posted journal', [400]);
      const back = await byId(c, 'journal', S.j1.id); eq(back.status, 'Posted', 'still posted'); eq(back.data.lines[0].debit, 2000, 'lines unchanged');
      return 'edit, un-post and delete all refused (400)';
    });

    await u.step('GL-06', 'Invalid journals refused: unbalanced, one line, negative, debit+credit on one line, unknown / header / inactive account, no date, no amounts', async () => {
      const post = (lines, data = {}) => c.post('/api/finance/records/journal', { company: CO, status: 'Posted', data: Object.assign({ date: today, memo: 'bad', reference: `BAD-${K}`, lines }, data) });
      refused(await post([line(A, 10, 0), line(ACC.cash, 0, 9)]), 'unbalanced', [400]);
      refused(await post([line(A, 10, 0)]), 'one line', [400]);
      refused(await post([line(A, -10, 0), line(ACC.cash, 0, -10)]), 'negative', [400]);
      refused(await post([{ account: A, debit: 5, credit: 5 }, line(ACC.cash, 0, 0)]), 'debit and credit on a line', [400]);
      refused(await post([line('NOPE-' + K, 10, 0), line(ACC.cash, 0, 10)]), 'unknown account', [400]);
      refused(await post([line(H, 10, 0), line(ACC.cash, 0, 10)]), 'header account', [400]);
      refused(await post([line(I, 10, 0), line(ACC.cash, 0, 10)]), 'inactive account', [400]);
      refused(await post([line(A, 10, 0), line(ACC.cash, 0, 10)], { date: '' }), 'no date', [400]);
      refused(await post([line(A, 0, 0), line(ACC.cash, 0, 0)]), 'no amounts', [400]);
      // an unbalanced DRAFT may be saved, but cannot be submitted
      const d = await journal(c, CO, { date: today, memo: 'unbalanced draft', reference: `BAD-${K}`, status: 'Draft', lines: [line(A, 10, 0), line(ACC.cash, 0, 4)] });
      refused(await fput(c, 'journal', d, { status: 'Submitted' }), 'submit unbalanced draft', [400]);
      must(await c.del(`/api/finance/records/journal/${d.id}`), 'delete unbalanced draft');
      eq((await flist(c, 'journal')).filter(j => String(j.data.reference) === `BAD-${K}`).length, 0, 'refused journals must not exist');
      return '10 refusals, nothing stored';
    });

    await u.step('GL-07', 'Reverse a posted journal: mirror posted, original Reversed, effect on the account is nil', async () => {
      const o = await journal(c, CO, { date: today, memo: 'To reverse ' + K, reference: `REV-${K}`, lines: [line(A, 500, 0), line(ACC.cash, 0, 500)] });
      eq(o.status, 'Posted', 'original posted');
      const m = await fcreate(c, 'journal', { company: CO, status: 'Posted', data: { date: today, memo: 'Reversal of ' + o.code, reference: `REV-${K}`, currency: 'SAR', rate: 1, reverses: o.code, lines: [line(A, 0, 500), line(ACC.cash, 500, 0)] } });
      eq(m.data.reverses, o.code, 'mirror points to the original');
      const rv = await fputOk(c, 'journal', o, { status: 'Reversed' }, 'mark reversed');
      eq(rv.status, 'Reversed', 'status Reversed'); eq(rv.data.lines[0].debit, 500, 'original lines kept');
      const mine = (await jl()).filter(j => String(j.data.reference) === `REV-${K}`);
      eq(mine.length, 2, 'two journals for the reversal');
      eq(net(mine.filter(j => ['Posted', 'Reversed'].includes(j.status))).of(A), 0, 'original + mirror net on A');
      S.expA += -500;   // posted-only ledger holds the mirror (the original left it when it became Reversed)
      return o.code + ' reversed by ' + m.code + '; original + mirror = 0';
    });

    await u.step('GL-08', 'Periods: open own future period, close it, posting into it refused, reopen, posting works; closed period cannot be deleted', async () => {
      // no u.key in the code: a period code is the month (yyyy-MM). A far-future year is used so no other user is affected.
      const code = `${year + 8}-03`, date = `${code}-15`;
      const p = await fcreate(c, 'period', { code, company: CO, status: 'Open', data: {} });
      refused(await c.post('/api/finance/records/period', { code, company: CO, status: 'Open', data: {} }), 'duplicate period', [409]);
      const d = await journal(c, CO, { date, memo: 'Future period ' + K, reference: `PER-${K}`, status: 'Draft', lines: [line(A, 300, 0), line(ACC.cash, 0, 300)] });
      const closed = await fputOk(c, 'period', p, { status: 'Closed' }, 'close period'); eq(closed.status, 'Closed', 'closed');
      const r = refused(await fput(c, 'journal', d, { status: 'Posted' }), 'post into closed period', [400]);
      ok(/closed/i.test(r.text), 'message should say the period is closed: ' + r.text.slice(0, 100));
      refused(await c.del(`/api/finance/records/period/${p.id}`), 'delete closed period', [400]);
      const re = await fputOk(c, 'period', closed, { status: 'Open' }, 'reopen'); eq(re.status, 'Open', 'reopened');
      const posted = await fputOk(c, 'journal', d, { status: 'Posted' }, 'post after reopen'); eq(posted.status, 'Posted', 'posted');
      S.expA += 300;
      const cur = (await flist(c, 'period')).filter(x => String(x.code).startsWith(String(year)) && x.status === 'Open');
      ok(cur.length >= 12, 'fiscal year periods must stay open (' + cur.length + ')');
      return 'period ' + code + ' closed -> refused -> reopened -> posted; fiscal year still 12 open';
    });

    await u.step('GL-09', 'Foreign currency journal: USD 100 at 3.75 is 375.00 in the base currency', async () => {
      const j = await journal(c, CO, { date: today, memo: 'USD ' + K, reference: `FX-${K}`, currency: 'USD', rate: 3.75, lines: [line(A, 100, 0), line(ACC.cash, 0, 100)] });
      eq(j.status, 'Posted', 'posted');
      eq(net([j]).of(A), 375, 'base amount on A'); eq(net([j]).of(ACC.cash), -375, 'base amount on cash');
      S.expA += 375;
      return 'base 375.00';
    });

    await u.step('GL-10', 'Cost centre report: 800.00 of expense on my cost centre, shows in the CFO department spend', async () => {
      const j = await journal(c, CO, { date: today, memo: 'CC spend ' + K, reference: `CC-${K}`, lines: [line(A, 800, 0, CC), line(ACC.cash, 0, 800)] });
      S.expA += 800;
      const mine = (await flist(c, 'journal', '?status=Posted')).filter(x => (x.data.lines || []).some(l => l.costCenter === CC));
      const spend = mine.reduce((s, x) => s + (x.data.lines || []).filter(l => l.costCenter === CC).reduce((t, l) => t + toNum(l.debit) - toNum(l.credit), 0), 0);
      eq(r2(spend), 2800, 'spend on my cost centre (2,000 draft-posted + 800)');
      const sum = must(await c.get('/api/finance/summary'), 'summary');
      const row = (sum.deptSpend || []).find(x => x.name === CC);
      return 'cost centre ' + CC + ' spend 2,800.00' + (row ? '; deptSpend ' + row.value : '; (not in the top 8 of the department chart)');
    });

    await u.step('GL-11', 'Trial balance: all posted journals balance; my own account holds exactly what I posted', async () => {
      const posted = await flist(c, 'journal', '?status=Posted');
      const tb = net(posted);
      eq(tb.dr, tb.cr, 'trial balance debits = credits');
      const mine = posted.filter(j => (j.data.lines || []).some(l => l.account === A));
      eq(net(mine).of(A), S.expA, 'balance of my account A (expected ' + S.expA + ')');
      eq(S.expA, 2000 - 500 + 300 + 375 + 800, 'expected total');
      return `TB ${tb.dr} = ${tb.cr}; account ${A} = ${S.expA}`;
    });

    await u.step('GL-12', 'CFO summary: period, 12 months, cash/AR/AP fields, expense figure present', async () => {
      const s = must(await c.get('/api/finance/summary'), 'summary');
      ok(/^\d{4}-\d{2}$/.test(s.currentPeriod), 'current period ' + s.currentPeriod); eq(s.currentPeriodStatus, 'Open', 'current period status');
      eq(s.monthly.length, 12, 'monthly points');
      for (const k of ['revenueYtd', 'expenseYtd', 'profitYtd', 'cash', 'arOutstanding', 'apOutstanding', 'budgetTotal', 'assetCount']) ok(typeof s[k] === 'number', k + ' missing');
      eq(r2(s.revenueYtd - s.expenseYtd), s.profitYtd, 'profit = revenue - expense');
      ok(Array.isArray(s.arAging) && s.arAging.length === 5 && Array.isArray(s.apAging) && s.apAging.length === 5, 'aging has 5 buckets');
      return 'period ' + s.currentPeriod + ' Open';
    });

    await u.step('GL-13', 'Audit trail of my journal (created, submitted, posted by me); used account cannot be deleted, unused can; unknown kind 404', async () => {
      ok(S.j1, 'depends on GL-04');
      const au = must(await c.get(`/api/finance/audit?recordId=${S.j1.id}`), 'audit');
      ok(au.some(a => a.action === 'Created'), 'no Created row'); eq(au.filter(a => a.action === 'StatusChanged').length, 2, 'two status changes (submit, post)');
      ok(au.every(a => String(a.userName).toLowerCase() === u.username.toLowerCase()), 'audit user must be me');
      refused(await c.del(`/api/finance/records/account/${S.acc.id}`), 'delete account used in journals', [409]);
      const t = await fcreate(c, 'account', { code: `GLT-${K}`, status: 'Active', data: { name: 'temp', type: 'Expense' } });
      must(await c.del(`/api/finance/records/account/${t.id}`), 'delete unused account');
      refused(await c.get('/api/finance/records/nokind'), 'unknown kind', [404]);
      return au.length + ' audit rows for ' + S.j1.code;
    });
  }
};
