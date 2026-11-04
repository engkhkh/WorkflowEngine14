// User 2 - Noura Al-Dossari, finance controller. Steps U2-01 .. U2-16 (+ small extras U2-01a..e, U2-16b).
// Written from the controller source (FinanceController, ModulesController*, PosController) and from the way the screens
// (mobile-app/src/app/finance, core/fin-posting.service.ts, core/fin.calc.ts) turn documents into journals:
// the API stores records and checks rules, the SCREENS create the GL journals. This runner does what the screens do.
// run.js must call require('./u2').preDay0(ctx) BEFORE day0 of the other users (see u2.notes.md); day0 also calls it if not done yet.
const { must, refused, eq, ok, round2, step, manual, addDays } = require('./lib');

// ---- chart of accounts used by the scenario (codes of the starter chart, plus 2210 / 2220 added here)
const ACC = {
  cash: '1010', bank: '1020', ar: '1100', vatIn: '1150', inv: '1200', fa: '1500', accDep: '1590',
  ap: '2100', vatOut: '2150', accrued: '2200', salPay: '2210', gosi: '2220',
  cap: '3100', sales: '4100', service: '4200', salaries: '6100', rent: '6200', office: '6500', dep: '6600',
};
const VENDORS = {
  'Gulf Medical Imports LLC': { code: 'VND-GMI', termsDays: 45, city: 'Jeddah' },
  'Eastern Textile Co.': { code: 'VND-ETC', termsDays: 30, city: 'Dammam' },
  'Riyadh Packaging Est.': { code: 'VND-RPE', termsDays: 30, city: 'Riyadh' },
};
const CUSTOMERS = {
  'Al-Hayat Clinics': { code: 'CUS-HAYAT', termsDays: 60, creditLimit: 150000, city: 'Riyadh' },
  'Najd Pharmacy Chain': { code: 'CUS-NAJD', termsDays: 30, creditLimit: 100000, city: 'Dammam' },
  'Walk-in customer': { code: 'CUS-WALKIN', termsDays: 0, creditLimit: 0, city: 'Dammam' },
};

// ---------------------------------------------------------------- helpers
const N = ctx => ctx.U.noura;
const year = ctx => Number(ctx.today.slice(0, 4));
const eom = ymd => { const [y, m] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const co = ctx => ctx.company || undefined;
const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const invTotal = d => (toNum(d && d.total) > 0 ? toNum(d.total) : toNum(d && d.amount) + toNum(d && d.taxAmount));

const flist = async (c, kind, q = '') => must(await c.get(`/api/finance/records/${kind}${q}`), `list ${kind}`);
const fcreate = async (c, kind, body) => must(await c.post(`/api/finance/records/${kind}`, body), `create ${kind}`);
/** PUT replaces the whole data object on the server, so always send the record's own data merged with the change (the screens do the same). */
async function fput(c, kind, rec, patch = {}) {
  const body = { status: patch.status || rec.status, data: Object.assign({}, rec.data, patch.data || {}) };
  if (patch.code) body.code = patch.code;
  return c.put(`/api/finance/records/${kind}/${rec.id}`, body);
}
const fputOk = async (c, kind, rec, patch, what) => must(await fput(c, kind, rec, patch), what || `update ${kind} ${rec.code}`);

/** Posted journals -> per-account debit / credit (base currency). */
async function trial(c) {
  const accounts = await flist(c, 'account');
  const type = {}; for (const a of accounts) type[a.code] = (a.data || {}).type;
  const js = await flist(c, 'journal', '?status=Posted');
  const by = {}; let dr = 0, cr = 0;
  for (const j of js) {
    const rate = toNum(j.data.rate) > 0 ? toNum(j.data.rate) : 1;
    for (const l of (j.data.lines || [])) {
      const a = by[l.account] || (by[l.account] = { d: 0, c: 0 });
      const d = toNum(l.debit) * rate, k = toNum(l.credit) * rate;
      a.d += d; a.c += k; dr += d; cr += k;
    }
  }
  const net = code => round2(((by[code] || {}).d || 0) - ((by[code] || {}).c || 0));   // debit - credit
  const revenue = round2(Object.keys(by).filter(k => type[k] === 'Revenue').reduce((s, k) => s + by[k].c - by[k].d, 0));
  return { by, dr: round2(dr), cr: round2(cr), net, revenue, journals: js };
}

/** Create a journal. Status Posted straight away is allowed for holders of finance.gl.approve (Noura has it). */
async function journal(ctx, c, { date, memo, reference, lines, status = 'Posted' }) {
  const body = { company: co(ctx), status, data: { date, memo, reference, currency: 'SAR', rate: 1,
    lines: lines.map(l => ({ account: l.account, debit: round2(l.debit || 0), credit: round2(l.credit || 0), costCenter: l.costCenter || '', project: '', memo: l.memo || '', icPartner: '' })) } };
  return fcreate(c, 'journal', body);
}

/** Supplier bill: Submitted -> Approved (3-way match) -> GL journal (like FinPostingService.apInvoice) posted. */
async function enterBill(ctx, s) {
  const c = N(ctx);
  const vendor = ctx.S.vendors[s.vendorName];
  const tax = round2(s.net * 0.15), total = round2(s.net + tax);
  const rec = await fcreate(c, 'apinvoice', { company: co(ctx), status: 'Submitted', data: {
    vendor, invoiceNo: s.invoiceNo, date: s.date, dueDate: s.due, currency: 'SAR', rate: 1, amount: round2(s.net), taxCode: 'VAT15-IN', taxAmount: tax, total,
    account: s.account || ACC.inv, costCenter: s.costCenter || 'PROC', project: '', notes: s.notes || '', paid: 0, glJournal: '',
    poNo: s.poNo || '', poAmount: toNum(s.poAmount), receivedAmount: toNum(s.receivedAmount), matchOverride: false } });
  const approved = await fputOk(c, 'apinvoice', rec, { status: 'Approved' }, `approve bill ${s.invoiceNo}`);
  const j = await journal(ctx, c, { date: s.date, memo: `${s.vendorName} - ${s.invoiceNo}`, reference: approved.code, lines: [
    { account: s.account || ACC.inv, debit: round2(s.net), costCenter: s.costCenter || 'PROC', memo: s.vendorName },
    { account: ACC.vatIn, debit: tax, memo: 'VAT' },
    { account: ACC.ap, credit: total, memo: s.vendorName }] });
  const done = await fputOk(c, 'apinvoice', approved, { data: { glJournal: j.code } }, `link journal to bill ${s.invoiceNo}`);
  return { bill: done, journal: j, total, tax };
}

/** Customer invoice: Draft/new -> Issued -> GL journal (like FinPostingService.arInvoice). */
async function issueInvoice(ctx, inv, revenueAcc) {
  const c = N(ctx);
  const d = inv.data || {};
  const total = round2(invTotal(d)), tax = round2(toNum(d.taxAmount)), net = round2(total - tax);
  const date = String(d.date || ctx.today).slice(0, 10);
  const issued = inv.status === 'Issued' ? inv : await fputOk(c, 'arinvoice', inv, { status: 'Issued' }, `issue ${inv.code}`);
  if (issued.data.glJournal) return { inv: issued, total, tax, net };
  const j = await journal(ctx, c, { date, memo: `${issued.data.customer} - ${issued.code}`, reference: issued.code, lines: [
    { account: ACC.ar, debit: total, memo: issued.data.customer },
    { account: revenueAcc, credit: net, memo: issued.data.customer },
    ...(tax ? [{ account: ACC.vatOut, credit: tax, memo: 'VAT' }] : [])] });
  const done = await fputOk(c, 'arinvoice', issued, { data: { glJournal: j.code } }, `link journal to ${issued.code}`);
  return { inv: done, total, tax, net, journal: j };
}

const fromS = (ctx, ...keys) => { let v = ctx.S; for (const k of keys) { v = v && v[k]; } return v; };

/** Find a purchase order: the id saved by u3 first (ctx.S.pos.<key> = {id, code}), else by total. */
async function findPo(ctx, key, total) {
  const all = must(await N(ctx).get('/api/erp/proc/records/po?take=500'), 'list purchase orders');
  const saved = fromS(ctx, 'pos', key);
  let po = saved && all.find(p => p.id === saved.id || (saved.code && p.code === saved.code));
  if (!po) po = all.find(p => Math.abs(toNum(p.data && p.data.total) - total) < 0.006);
  if (!po) throw new Error(`purchase order ${key} (total ${total}) not found: depends on U3-04/U3-05 (Faisal's orders; ctx.S.pos.${key})`);
  return po;
}
const poReceivedNet = po => round2((po.data.lines || []).reduce((s, l) => s + toNum(l.received) * toNum(l.price) * (1 - toNum(l.discountPct) / 100), 0));

async function listAr(ctx) { return flist(N(ctx), 'arinvoice'); }
const custMatches = (val, name, code) => {
  const v = String(val || '').toLowerCase();
  return v === code.toLowerCase() || v === name.toLowerCase() || v.includes(name.toLowerCase().split(' ')[0]);
};
/** An invoice for `name` with this total: one that Reem's sales/project flow already created (Draft), else null. */
async function findArFor(ctx, name, total) {
  const code = ctx.S.customers[name];
  const all = await listAr(ctx);
  const cands = all.filter(r => ['Draft', 'Issued'].includes(r.status) && Math.abs(invTotal(r.data) - total) < 0.01);
  return cands.find(r => custMatches(r.data.customer, name, code)) || (cands.length === 1 ? cands[0] : null);
}

async function summary(ctx) { return must(await N(ctx).get('/api/finance/summary'), 'finance summary'); }

// ---------------------------------------------------------------- Day 0 (pre): master data other users depend on
async function preDay0(ctx) {
  if (ctx.S._u2pre) return;
  ctx.S._u2pre = true;
  const n = N(ctx);
  ctx.S.vendors = {}; for (const [k, v] of Object.entries(VENDORS)) ctx.S.vendors[k] = v.code;
  ctx.S.customers = {}; for (const [k, v] of Object.entries(CUSTOMERS)) ctx.S.customers[k] = v.code;
  ctx.S.accounts = ACC;
  ctx.S.costCenters = { procurement: 'PROC', sales: 'SALES' };
  if (!n) return;

  await step('U2-01a', 'Finance setup: standard chart of accounts (+ salaries payable, GOSI payable)', async () => {
    const r = await n.post('/api/finance/accounts/seed', {});
    let note;
    if (r.ok) { eq(r.data.created, 30, 'accounts created'); note = 'starter chart: 30 accounts'; }
    else if (r.status === 409) note = 'chart already existed (409)';
    else must(r, 'accounts/seed');
    // second seed must be refused
    refused(await n.post('/api/finance/accounts/seed', {}), 'second seed');
    const have = (await flist(n, 'account')).map(a => a.code);
    for (const [code, name, type] of [[ACC.salPay, 'Salaries payable', 'Liability'], [ACC.gosi, 'GOSI payable', 'Liability']]) {
      if (!have.includes(code)) await fcreate(n, 'account', { code, status: 'Active', data: { name, nameAr: name, type, isHeader: false } });
    }
    const all = (await flist(n, 'account')).map(a => a.code);
    for (const code of Object.values(ACC)) ok(all.includes(code), `account ${code} missing from the chart`);
    return note + '; ' + all.length + ' accounts';
  });

  await step('U2-01b', 'Finance setup: VAT 15% output and input tax codes, cost centres, asset class', async () => {
    const mk = async (kind, code, data) => {
      const ex = (await flist(n, kind)).find(x => x.code === code);
      if (!ex) await fcreate(n, kind, { code, status: 'Active', data });
    };
    await mk('taxcode', 'VAT15-OUT', { name: 'VAT 15% output', rate: 15 });
    await mk('taxcode', 'VAT15-IN', { name: 'VAT 15% input', rate: 15 });
    await mk('costcenter', 'PROC', { name: 'Procurement', nameAr: 'المشتريات' });
    await mk('costcenter', 'SALES', { name: 'Sales', nameAr: 'المبيعات' });
    await mk('assetclass', 'MED', { name: 'Medical equipment', lifeMonths: 60, method: 'SL' });
    const tax = await flist(n, 'taxcode');
    eq(tax.find(t => t.code === 'VAT15-OUT').data.rate, 15, 'VAT output rate');
    eq(tax.find(t => t.code === 'VAT15-IN').data.rate, 15, 'VAT input rate');
    const lk = must(await n.get('/api/erp/proc/lookups/taxcodes'), 'taxcodes lookup');
    ok(lk.length >= 2, 'tax codes not visible in the module lookup');
    return 'VAT15-OUT, VAT15-IN, cost centres PROC / SALES, asset class MED';
  });

  await step('U2-01c', `Fiscal year ${year(ctx)} with 12 open periods`, async () => {
    const have = (await flist(n, 'period')).map(p => p.code);
    for (let m = 1; m <= 12; m++) {
      const code = `${year(ctx)}-${String(m).padStart(2, '0')}`;
      if (!have.includes(code)) await fcreate(n, 'period', { code, company: co(ctx), status: 'Open', data: {} });
    }
    const ps = (await flist(n, 'period')).filter(p => String(p.code).startsWith(String(year(ctx))));
    eq(ps.length, 12, 'periods');
    ok(ps.every(p => p.status === 'Open'), 'a period is not Open');
    return '12 open periods';
  });

  await step('U2-01d', 'Finance setup: controls and default GL accounts', async () => {
    const sets = await flist(n, 'setting');
    if (!sets.find(s => s.code === 'controls')) await fcreate(n, 'setting', { code: 'controls', status: 'Active', data: { enforceSod: false, matchTolerancePct: 2 } });
    const defaults = { arAccount: ACC.ar, apAccount: ACC.ap, bankAccount: ACC.cash, revenueAccount: ACC.sales, expenseAccount: ACC.office, vatInput: ACC.vatIn, vatOutput: ACC.vatOut, deprExpense: ACC.dep, deprAccum: ACC.accDep };
    const ex = sets.find(s => s.code === 'defaults');
    if (ex) await fputOk(n, 'setting', ex, { data: defaults }); else await fcreate(n, 'setting', { code: 'defaults', status: 'Active', data: defaults });
    const back = (await flist(n, 'setting')).find(s => s.code === 'defaults');
    eq(back.data.vatOutput, ACC.vatOut, 'default vatOutput');
    return 'POS shift close will draft its journal against bankAccount 1010 (cash on hand), revenue 4100, VAT output 2150';
  });

  await step('U2-01e', 'Master data: suppliers and customers (codes shared with the other users)', async () => {
    const exV = (await flist(n, 'vendor')).map(v => v.code), exC = (await flist(n, 'customer')).map(v => v.code);
    for (const [name, v] of Object.entries(VENDORS))
      if (!exV.includes(v.code)) await fcreate(n, 'vendor', { code: v.code, status: 'Active', data: { name, nameAr: name, email: `${v.code.toLowerCase()}@example.com`, termsDays: v.termsDays, city: v.city } });
    for (const [name, v] of Object.entries(CUSTOMERS))
      if (!exC.includes(v.code)) await fcreate(n, 'customer', { code: v.code, status: 'Active', data: { name, nameAr: name, email: `${v.code.toLowerCase()}@example.com`, termsDays: v.termsDays, creditLimit: v.creditLimit, city: v.city } });
    const lkv = must(await n.get('/api/erp/proc/lookups/vendors'), 'vendor lookup');
    for (const [name, v] of Object.entries(VENDORS)) ok(lkv.some(x => x.code === v.code && x.name === name), `supplier ${name} missing in lookups/vendors`);
    const lkc = must(await n.get('/api/erp/crm/lookups/customers'), 'customer lookup');
    for (const [name, v] of Object.entries(CUSTOMERS)) ok(lkc.some(x => x.code === v.code && x.name === name), `customer ${name} missing in lookups/customers`);
    return 'vendors ' + JSON.stringify(ctx.S.vendors) + ' customers ' + JSON.stringify(ctx.S.customers);
  });
}

// ---------------------------------------------------------------- Day 0
async function day0(ctx) {
  await preDay0(ctx);
  const n = N(ctx);

  await step('U2-01', 'Opening balance journal Dr Bank 500,000 / Cr Share capital 500,000; trial balance 500,000 each side', async () => {
    const j = await journal(ctx, n, { date: `${year(ctx)}-01-01`, memo: 'Opening balance', reference: 'OPEN', lines: [{ account: ACC.bank, debit: 500000, memo: 'Opening bank' }, { account: ACC.cap, credit: 500000, memo: 'Share capital' }] });
    eq(j.status, 'Posted', 'journal status');
    ok(!!j.approvedBy, 'approvedBy not recorded');
    const tb = await trial(n);
    eq(tb.dr, 500000, 'trial balance debit'); eq(tb.cr, 500000, 'trial balance credit');
    eq(tb.net(ACC.bank), 500000, 'bank 1020 debit'); eq(tb.net(ACC.cap), -500000, 'share capital 3100 credit');
    // an unbalanced journal must be refused
    refused(await n.post('/api/finance/records/journal', { company: co(ctx), status: 'Posted', data: { date: ctx.today, lines: [{ account: ACC.bank, debit: 10, credit: 0 }, { account: ACC.cap, debit: 0, credit: 9 }] } }), 'unbalanced journal');
    return `journal ${j.code}; TB debit ${tb.dr} = credit ${tb.cr}`;
  });

  await step('U2-02', 'Bank account Operating SAR with opening 500,000; GL bank balance equals bank balance', async () => {
    const b = await fcreate(n, 'bankaccount', { code: 'OPER', company: co(ctx), status: 'Active', data: { name: 'Operating SAR', bankName: 'Operating bank', currency: 'SAR', glAccount: ACC.bank, openingBalance: 500000 } });
    ctx.S.bankAccount = b.code;
    const s = await summary(ctx);
    eq(s.cash, 500000, 'bank balance (summary.cash)');
    ok(s.cashByAccount.some(x => x.name === 'Operating SAR' && Math.abs(x.value - 500000) < 0.01), 'Operating SAR not listed in cash by account');
    const tb = await trial(n);
    eq(tb.net(ACC.bank), s.cash, 'GL bank 1020 vs bank balance');
    return 'bank 500,000.00 = GL 1020 500,000.00';
  });
}

// ---------------------------------------------------------------- Day 1
async function day1(ctx) {
  const n = N(ctx);
  await step('U2-03', 'Approve the Gulf (47,380) and Eastern (8,625) purchase orders (and the Riyadh Packaging one if still Draft)', async () => {
    const notes = [];
    const gulf = await findPo(ctx, 'gulf', 47380), east = await findPo(ctx, 'eastern', 8625), pack = await findPo(ctx, 'packaging', 1230.5);
    eq(gulf.data.amount, 41200, 'Gulf subtotal'); eq(gulf.data.taxAmount, 6180, 'Gulf VAT'); eq(gulf.data.total, 47380, 'Gulf total');
    eq(east.data.total, 8625, 'Eastern total'); eq(pack.data.total, 1230.5, 'Packaging total');
    ok(!!ctx.S.vendors, 'vendors missing');
    const pending = must(await n.get('/api/erp/proc/records/po?status=Draft'), 'Noura approval list').map(p => p.id);
    ok(pending.includes(gulf.id) && pending.includes(east.id), 'Gulf / Eastern orders are not on the Draft (approval) list');
    for (const po of [gulf, east]) {
      const a = must(await n.post(`/api/erp/proc/pos/${po.id}/approve`, {}), 'approve ' + po.code);
      eq(a.status, 'Approved', po.code + ' status'); ok(!!a.updatedAt, 'updatedAt missing (approval time)');
      refused(await n.post(`/api/erp/proc/pos/${po.id}/approve`, {}), 'second approval of ' + po.code);
    }
    const after = must(await n.get('/api/erp/proc/records/po?status=Draft'), 'approval list after').map(p => p.id);
    ok(!after.includes(gulf.id) && !after.includes(east.id), 'approved orders still on the Draft list');
    if (pack.status === 'Draft') {
      const a = must(await n.post(`/api/erp/proc/pos/${pack.id}/approve`, {}), 'approve packaging');
      eq(a.status, 'Approved', 'packaging status'); notes.push('Riyadh Packaging was still Draft (no auto-approval under 5,000 in the API) - approved by Noura');
    } else notes.push('Riyadh Packaging already ' + pack.status);
    ctx.S.poApproved = true;
    return notes.concat(['approval comment and approver name are not stored by /pos/{id}/approve']).join('; ');
  });
}

// ---------------------------------------------------------------- Day 2
async function day2(ctx) {
  const n = N(ctx);
  await step('U2-04', 'Payables: bill GMI-7741 for what was received (46,747.50), 3-way match, posting', async () => {
    const po = await findPo(ctx, 'gulf', 47380);
    eq(po.status, 'PartiallyReceived', 'Gulf order status after U3-06');
    const therm = (po.data.lines || []).find(l => String(l.sku).toUpperCase().includes('THERM'));
    ok(therm, 'THERM line not on the Gulf order');
    eq(toNum(therm.qty) - toNum(therm.received), 50, 'thermometers still open on the order');
    const net = poReceivedNet(po);
    eq(net, 40650, 'received value net');
    const recv = round2(net * 1.15);
    const date = ctx.today;
    const r = await enterBill(ctx, { vendorName: 'Gulf Medical Imports LLC', invoiceNo: 'GMI-7741', net, date, due: addDays(date, 45), poNo: po.code, poAmount: po.data.total, receivedAmount: recv, notes: 'Goods received U3-06' });
    eq(r.total, 46747.5, 'bill total'); eq(r.tax, 6097.5, 'bill VAT');
    eq(r.bill.status, 'Approved', 'bill status'); eq(r.bill.data.matchStatus, 'Matched', 'match status');
    const jl = (await flist(n, 'journal')).find(j => j.code === r.journal.code).data.lines;
    const dr = a => jl.filter(l => l.account === a).reduce((s, l) => s + toNum(l.debit), 0), cr = a => jl.filter(l => l.account === a).reduce((s, l) => s + toNum(l.credit), 0);
    eq(dr(ACC.inv), 40650, 'Dr Inventory'); eq(dr(ACC.vatIn), 6097.5, 'Dr VAT input'); eq(cr(ACC.ap), 46747.5, 'Cr Payables');
    // controls enforced by the server
    refused(await n.post('/api/finance/records/apinvoice', { company: co(ctx), status: 'Submitted', data: { vendor: ctx.S.vendors['Gulf Medical Imports LLC'], invoiceNo: 'GMI-7741', date, dueDate: date, amount: 100, taxAmount: 15, total: 115 } }), 'duplicate supplier invoice');
    const bad = await fcreate(n, 'apinvoice', { company: co(ctx), status: 'Draft', data: { vendor: ctx.S.vendors['Gulf Medical Imports LLC'], invoiceNo: 'GMI-TEST-OVER', date, dueDate: date, amount: 50000, taxAmount: 7500, total: 57500, poNo: po.code, poAmount: po.data.total, receivedAmount: recv } });
    eq(bad.data.matchStatus, 'Mismatch', 'over-invoice match status');
    refused(await fput(n, 'apinvoice', bad, { status: 'Approved' }), 'approve a mismatched invoice');
    must(await n.del(`/api/finance/records/apinvoice/${bad.id}`), 'delete test invoice');
    ctx.S.ap = ctx.S.ap || {}; ctx.S.ap.gmi = { id: r.bill.id, code: r.bill.code, total: r.total };
    return `bill ${r.bill.code} 46,747.50 Matched; journal ${r.journal.code} Dr 1200 40,650 / Dr 1150 6,097.50 / Cr 2100 46,747.50; duplicate and over-invoice refused`;
  });

  await step('U2-05', 'Payables: bills from Eastern Textile 8,625 and Riyadh Packaging 1,230.50', async () => {
    const date = ctx.today;
    const out = [];
    for (const [key, vendorName, no, net, total] of [['eastern', 'Eastern Textile Co.', 'ETC-2201', 7500, 8625], ['packaging', 'Riyadh Packaging Est.', 'RPE-3310', 1070, 1230.5]]) {
      let poRef = null;
      try { poRef = await findPo(ctx, key, total); } catch (e) { out.push('PO not found: ' + e.message); }
      const r = await enterBill(ctx, { vendorName, invoiceNo: no, net, date, due: addDays(date, 30), poNo: poRef ? poRef.code : '', poAmount: poRef ? poRef.data.total : total, receivedAmount: poRef ? round2(poReceivedNet(poRef) * 1.15) : total });
      eq(r.total, total, vendorName + ' total'); eq(r.bill.status, 'Approved', 'status');
      eq(r.bill.data.matchStatus, poRef ? 'Matched' : 'NoPO', vendorName + ' match status');
      ctx.S.ap = ctx.S.ap || {}; ctx.S.ap[key] = { id: r.bill.id, code: r.bill.code, total };
      out.push(`${vendorName} ${r.bill.code} ${total}`);
    }
    const bills = await flist(n, 'apinvoice');
    for (const v of ['Eastern Textile Co.', 'Riyadh Packaging Est.'])
      eq(bills.filter(b => b.data.vendor === ctx.S.vendors[v]).length, 1, 'supplier statement for ' + v);
    return out.join('; ');
  });
}

// ---------------------------------------------------------------- Day 3
async function day3(ctx) {
  const n = N(ctx);

  await step('U2-06', 'Receivables: confirm invoices Al-Hayat 17,250, Najd 14,490 and project milestone 27,600', async () => {
    const specs = [['Al-Hayat Clinics', 17250, 15000, 60, ACC.sales, 'hay1'], ['Najd Pharmacy Chain', 14490, 12600, 30, ACC.sales, 'najd'], ['Al-Hayat Clinics', 27600, 24000, 60, ACC.service, 'hay2']];
    const notes = [];
    for (const [name, total, net, terms, rev, key] of specs) {
      let inv = await findArFor(ctx, name, total);
      if (!inv) {
        // Reem's sales / project flow did not leave a matching draft in Finance: enter it here so the money chain can still be checked.
        inv = await fcreate(n, 'arinvoice', { company: co(ctx), status: 'Draft', data: { customer: ctx.S.customers[name], date: ctx.today, dueDate: addDays(ctx.today, terms), currency: 'SAR', rate: 1,
          amount: net, taxCode: 'VAT15-OUT', taxAmount: round2(total - net), total, notes: 'entered by Noura (no draft found from U4)', paid: 0 } });
        notes.push(`${key}: no Draft ${total} for ${name} from U4, created by Noura`);
      }
      const keepDue = inv.data.dueDate ? {} : { dueDate: addDays(ctx.today, terms) };
      inv = await fputOk(n, 'arinvoice', inv, { data: Object.assign({ customer: ctx.S.customers[name] }, keepDue) }, 'normalise customer ' + inv.code);
      const r = await issueInvoice(ctx, inv, rev);
      eq(r.total, total, 'invoice total'); eq(r.inv.status, 'Issued', 'invoice status');
      ctx.S.ar = ctx.S.ar || {}; ctx.S.ar[key] = { id: r.inv.id, code: r.inv.code, total };
    }
    const all = (await listAr(ctx)).filter(r => r.status === 'Issued');
    eq(all.length, 3, 'open invoices');
    const hay = all.filter(r => r.data.customer === ctx.S.customers['Al-Hayat Clinics']).reduce((s, r) => s + invTotal(r.data), 0);
    eq(hay, 44850, 'Al-Hayat open total');
    const cust = (await flist(n, 'customer')).find(c => c.code === ctx.S.customers['Al-Hayat Clinics']);
    ok(hay < toNum(cust.data.creditLimit), 'Al-Hayat is over its credit limit');
    const s = await summary(ctx);
    eq(s.arOutstanding, 59340, 'receivables outstanding'); eq(s.arAging[0].value, 59340, 'ageing: current'); eq(s.arOverdue, 0, 'overdue');
    return 'three Issued invoices, Al-Hayat 44,850 < limit ' + cust.data.creditLimit + ', ageing all current 59,340.00' + (notes.length ? '; ' + notes.join('; ') : '');
  });

  await step('U2-07', 'Bank: pay Eastern 8,625; receive 10,000 from Najd; reconcile; bank 501,375', async () => {
    ok(ctx.S.ap && ctx.S.ap.eastern, 'depends on U2-05 (Eastern bill)');
    ok(ctx.S.ar && ctx.S.ar.najd, 'depends on U2-06 (Najd invoice)');
    const date = ctx.today;
    // --- pay the Eastern bill (status Approved -> Paid, bank line, payment journal)
    const bill = (await flist(n, 'apinvoice')).find(b => b.id === ctx.S.ap.eastern.id);
    const paid = await fputOk(n, 'apinvoice', bill, { status: 'Paid', data: { paid: 8625, paidDate: date, bankAccount: 'OPER' } }, 'pay Eastern bill');
    eq(paid.status, 'Paid', 'bill status');
    const t1 = await fcreate(n, 'banktxn', { company: co(ctx), status: 'Active', data: { account: 'OPER', date, amount: -8625, description: 'Payment ' + paid.code, reference: paid.code, reconciled: false } });
    await journal(ctx, n, { date, memo: 'Payment Eastern Textile - ETC-2201', reference: paid.code, lines: [{ account: ACC.ap, debit: 8625 }, { account: ACC.bank, credit: 8625 }] });
    // --- receive 10,000 from Najd (part payment: invoice stays Issued)
    const inv = (await listAr(ctx)).find(r => r.id === ctx.S.ar.najd.id);
    const part = await fputOk(n, 'arinvoice', inv, { status: 'Issued', data: { paid: 10000, paidDate: date, bankAccount: 'OPER' } }, 'receive Najd payment');
    eq(part.status, 'Issued', 'Najd invoice stays open');
    const t2 = await fcreate(n, 'banktxn', { company: co(ctx), status: 'Active', data: { account: 'OPER', date, amount: 10000, description: 'Receipt ' + part.code, reference: part.code, reconciled: false } });
    await fcreate(n, 'receipt', { company: co(ctx), status: 'Active', data: { invoice: part.code, customer: part.data.customer, amount: 10000, date, bank: 'OPER' } });
    await journal(ctx, n, { date, memo: 'Receipt Najd Pharmacy Chain - ' + part.code, reference: part.code, lines: [{ account: ACC.bank, debit: 10000 }, { account: ACC.ar, credit: 10000 }] });
    // --- reconcile both against the statement
    for (const t of [t1, t2]) await fputOk(n, 'banktxn', t, { data: { reconciled: true } }, 'reconcile ' + t.id);
    const txns = (await flist(n, 'banktxn')).filter(t => t.data.account === 'OPER');
    ok(txns.every(t => t.data.reconciled === true), 'a bank line is not reconciled');
    const s = await summary(ctx);
    eq(s.cash, 501375, 'bank balance');
    const tb = await trial(n);
    eq(tb.net(ACC.bank), 501375, 'GL bank 1020');
    const najd = (await listAr(ctx)).find(r => r.id === ctx.S.ar.najd.id);
    eq(invTotal(najd.data) - toNum(najd.data.paid), 4490, 'Najd still open');
    return 'bank 501,375.00 = GL 1020; Eastern bill Paid; Najd open 4,490.00; both bank lines reconciled';
  });

  await step('U2-08', 'Post the Dammam POS day to the GL (shift-close journal drafted from the POS shift)', async () => {
    const js = (await flist(n, 'journal')).filter(j => String(j.code).startsWith('POS-'));
    if (!js.length) throw new Error('no POS-<shift> journal found: depends on U4-12 (Reem closes the shift) and on Finance defaults bankAccount / revenueAccount / vatOutput (set in U2-01d)');
    const draft = js.filter(j => j.status === 'Draft');
    ok(draft.length > 0, 'POS journal exists but is not Draft: ' + js.map(j => j.code + ':' + j.status).join(','));
    let cash = 0, sales = 0, vat = 0;
    for (const j of draft) {
      for (const l of j.data.lines) {
        if (l.account === ACC.cash) cash += toNum(l.debit);
        if (l.account === ACC.sales) sales += toNum(l.credit) - toNum(l.debit);
        if (l.account === ACC.vatOut) vat += toNum(l.credit);
      }
    }
    eq(round2(cash), 133.63, 'Dr cash and card'); eq(round2(sales), 116.2, 'Cr Sales'); eq(round2(vat), 17.43, 'Cr VAT output');
    for (const j of draft) await fputOk(n, 'journal', j, { status: 'Posted' }, 'post ' + j.code);
    const tb = await trial(n);
    eq(tb.dr, tb.cr, 'trial balance still balances');
    ctx.S.posJournals = draft.map(j => j.code);
    return `${draft.map(j => j.code).join(',')} posted: Dr 1010 ${round2(cash)}, Cr 4100 ${round2(sales)}, Cr 2150 ${round2(vat)}`;
  });
}

// ---------------------------------------------------------------- Day 4
async function day4(ctx) {
  const n = N(ctx), kh = ctx.U.khalid;

  await step('U2-09', 'Journal Dr Rent 12,000 / Cr Accrued expenses 12,000, entered by Noura, approved by Khalid', async () => {
    ok(kh, 'khalid client missing');
    const controls = (await flist(n, 'setting')).find(s => s.code === 'controls');
    ok(controls, 'controls setting missing (U2-01d)');
    const date = eom(ctx.today);
    let jv, sodNote = '';
    try {
      await fputOk(n, 'setting', controls, { data: { enforceSod: true } }, 'turn segregation of duties on');
      jv = await journal(ctx, n, { date, memo: 'October rent accrual', reference: 'RENT', status: 'Submitted', lines: [{ account: ACC.rent, debit: 12000, memo: 'Rent' }, { account: ACC.accrued, credit: 12000, memo: 'Accrued rent' }] });
      eq(jv.status, 'Submitted', 'status after entry');
      const before = await trial(n);
      eq(before.net(ACC.rent), 0, 'rent in the trial balance before approval');
      eq(before.net(ACC.accrued), 0, 'accrued expenses in the trial balance before approval');
      const s = await summary(ctx);
      ok(s.journalsToApprove >= 1, 'journal not counted under journals to approve');
      const r = refused(await fput(n, 'journal', jv, { status: 'Posted' }), 'Noura posting her own journal with segregation on');
      sodNote = 'own posting refused: ' + String(r.text).slice(0, 80);
      const posted = await fputOk(kh, 'journal', jv, { status: 'Posted' }, 'Khalid approves');
      eq(posted.status, 'Posted', 'status'); eq(posted.approvedBy, ctx.users.khalid, 'approved by');
    } finally {
      const cur = (await flist(n, 'setting')).find(s => s.code === 'controls');
      if (cur) await fput(n, 'setting', cur, { data: { enforceSod: false } });
    }
    const after = await trial(n);
    eq(after.net(ACC.rent), 12000, 'rent after approval'); eq(after.net(ACC.accrued), -12000, 'accrued after approval'); eq(after.dr, after.cr, 'trial balance balanced');
    ctx.S.rentJournal = { id: jv.id, code: jv.code };
    return `${jv.code} Submitted -> Posted by ${ctx.users.khalid}; ${sodNote}`;
  });

  await step('U2-10', 'Budget Procurement 150,000 against spend (before the 632.50 bill)', async () => {
    const b = await fcreate(n, 'budget', { company: co(ctx), status: 'Active', data: { year: year(ctx), costCenter: 'PROC', account: '', amount: 150000, notes: 'Q4 Procurement budget' } });
    const bills = (await flist(n, 'apinvoice')).filter(x => x.data.costCenter === 'PROC' && !['Rejected', 'Draft'].includes(x.status));
    const spend = round2(bills.reduce((s, x) => s + toNum(x.data.amount), 0));
    eq(spend, 49220, 'procurement spend (net of VAT)');
    eq(round2(spend / 150000 * 100), 32.81, 'used %', 0.01); eq(round2(150000 - spend), 100780, 'left');
    const s = await summary(ctx);
    const row = s.budgetRows.find(r => r.name === 'PROC');
    ok(row, 'budget row PROC missing from the finance summary'); eq(row.budget, 150000, 'budget amount');
    return `spend ${spend} = 32.8% of 150,000, left 100,780. Doc deviation: the ledger "actual" the screen shows for this budget is posted EXPENSE with cost centre PROC = ${row.actual} because purchases are booked to Inventory 1200`;
  });

  await step('U2-11', 'Fixed asset AC-01 autoclave 36,000, straight line 5 years; October depreciation 600.00', async () => {
    const start = ctx.today.slice(0, 8) + '01', month = ctx.today.slice(0, 7);
    const a = await fcreate(n, 'asset', { code: 'AC-01', company: co(ctx), status: 'Active', data: { name: 'Autoclave', class: 'MED', cost: 36000, salvage: 0, lifeMonths: 60, method: 'SL', inServiceDate: start, accumulated: 0, location: 'Riyadh Hospital' } });
    const dep = round2((36000 - 0) / 60);   // months due: in-service month .. this month = 1
    eq(dep, 600, 'monthly depreciation');
    const j = await journal(ctx, n, { date: eom(ctx.today), memo: 'Depreciation ' + month, reference: 'DEPR-' + month, lines: [{ account: ACC.dep, debit: dep, memo: month }, { account: ACC.accDep, credit: dep, memo: month }] });
    const upd = await fputOk(n, 'asset', a, { data: { accumulated: dep, lastPeriod: month } }, 'book depreciation on the asset');
    eq(upd.data.accumulated, 600, 'accumulated'); eq(round2(36000 - toNum(upd.data.accumulated)), 35400, 'net book value');
    const tb = await trial(n);
    eq(tb.net(ACC.dep), 600, 'Dr Depreciation expense'); eq(tb.net(ACC.accDep), -600, 'Cr Accumulated depreciation');
    const s = await summary(ctx);
    eq(s.assetCount, 1, 'asset count'); eq(s.assetCost, 36000, 'asset cost'); eq(s.assetAccumulated, 600, 'asset accumulated');
    return `journal ${j.code}: Dr 6600 600 / Cr 1590 600; NBV 35,400.00`;
  });

  await step('U2-12', 'Assets (maintenance): plan every 30 days for AC-01, meter 120 h, work order from the plan', async () => {
    const asset = must(await n.post('/api/erp/ast/records/asset', { code: 'AC-01', company: co(ctx), data: { name: 'Autoclave', category: 'Machinery', location: 'Riyadh Hospital', cost: 36000, criticality: 'High', finAsset: 'AC-01' } }), 'create maintenance asset');
    const due = addDays(ctx.today, 30);
    const plan = must(await n.post('/api/erp/ast/records/plan', { company: co(ctx), ref: 'AC-01', data: { name: 'Monthly autoclave service', frequencyDays: 30, nextDue: due, task: 'Service the autoclave: seals, valves, calibration' } }), 'create plan');
    const meter = must(await n.post('/api/erp/ast/records/meter', { company: co(ctx), ref: 'AC-01', data: { date: ctx.today, meter: 'Hours', value: 120, notes: 'reading at commissioning' } }), 'meter reading');
    eq(meter.data.value, 120, 'meter value');
    const wo = must(await n.post(`/api/erp/ast/plans/${plan.id}/generate`, {}), 'generate work order');
    eq(wo.status, 'Open', 'work order status'); eq(wo.ref, 'AC-01', 'work order asset'); eq(wo.parent, plan.code, 'work order plan');
    eq(wo.data.due, due, 'work order due date (30 days out)'); eq(wo.data.type, 'Preventive', 'type');
    const plans = must(await n.get('/api/erp/ast/records/plan'), 'plans');
    eq(plans.find(p => p.id === plan.id).data.nextDue, addDays(due, 30), 'plan next due moved on');
    // service it so the asset history is updated
    must(await n.post(`/api/erp/ast/aworkorders/${wo.id}/start`, {}), 'start work order');
    const done = must(await n.post(`/api/erp/ast/aworkorders/${wo.id}/complete`, { cost: 450, hours: 3, note: 'Seals replaced' }), 'complete work order');
    eq(done.status, 'Completed', 'completed');
    const a2 = must(await n.get('/api/erp/ast/records/asset'), 'assets').find(x => x.id === asset.id);
    ok(a2.data.lastService, 'asset lastService not updated');
    return `plan ${plan.code} -> work order ${wo.code} due ${due}; asset lastService ${a2.data.lastService}`;
  });

  await step('U2-13', 'EPM: FY revenue plan 2,400,000 by quarter; approve, publish; Q1 forecast 520,000', async () => {
    const fy = String(year(ctx) + 1);
    const plan = must(await n.post('/api/erp/epm/records/plan', { company: co(ctx), data: { name: `FY${fy} Revenue`, year: fy, scenario: 'Base', version: 'v1' } }), 'create plan');
    eq(plan.status, 'Draft', 'new plan status');
    const q = [500000, 550000, 650000, 700000];
    for (let i = 0; i < 4; i++) must(await n.post('/api/erp/epm/records/line', { company: co(ctx), ref: plan.code, data: { costCenter: 'SALES', account: ACC.sales, amount: q[i], note: 'Q' + (i + 1) } }), 'plan line Q' + (i + 1));
    const lines = must(await n.get('/api/erp/epm/records/line'), 'plan lines').filter(l => l.ref === plan.code);
    eq(lines.reduce((s, l) => s + toNum(l.data.amount), 0), 2400000, 'plan total');
    refused(await n.post(`/api/erp/epm/plans/${plan.id}/publish`, {}), 'publish before approval');
    const ap = must(await n.post(`/api/erp/epm/plans/${plan.id}/approve`, {}), 'approve plan'); eq(ap.status, 'Approved', 'approved');
    const pub = must(await n.post(`/api/erp/epm/plans/${plan.id}/publish`, {}), 'publish plan'); eq(pub.status, 'Published', 'published');
    const bud = (await flist(n, 'budget')).filter(b => b.data.plan === plan.code);
    eq(bud.length, 1, 'budget rows published to Finance'); eq(bud[0].data.amount, 2400000, 'published budget amount');
    const fcs = [];
    for (let i = 0; i < 4; i++) fcs.push(must(await n.post('/api/erp/epm/records/forecast', { company: co(ctx), data: { period: `${fy}-${String(1 + i * 3).padStart(2, '0')}`, costCenter: 'SALES', account: ACC.sales, amount: q[i], basis: 'Q' + (i + 1) + ' forecast' } }), 'forecast Q' + (i + 1)));
    const q1 = await n.put(`/api/erp/epm/records/forecast/${fcs[0].id}`, { status: fcs[0].status, data: Object.assign({}, fcs[0].data, { amount: 520000 }) });
    must(q1, 'change Q1 forecast');
    const fnow = must(await n.get('/api/erp/epm/records/forecast'), 'forecasts').filter(f => String(f.data.period).startsWith(fy));
    eq(fnow.reduce((s, f) => s + toNum(f.data.amount), 0), 2420000, 'forecast total');
    const lines2 = must(await n.get('/api/erp/epm/records/line'), 'plan lines again').filter(l => l.ref === plan.code);
    eq(lines2.reduce((s, l) => s + toNum(l.data.amount), 0), 2400000, 'plan total unchanged');
    ctx.S.epmPlan = { id: plan.id, code: plan.code };
    return `plan ${plan.code} Published (budget 2,400,000 in Finance); forecast total 2,420,000, plan total 2,400,000. No separate "submit" state exists: Draft -> Approved -> Published`;
  });

  await step('U2-14', 'EPM variance: Q4 revenue plan 600,000 against revenue invoiced to date', async () => {
    const tb = await trial(n);
    const actual = tb.revenue, plan = 600000;
    eq(actual, 51716.2, 'revenue actual to date (15,000 + 12,600 + 24,000 + 116.20)');
    const variance = round2(actual - plan), pct = round2(variance / plan * 100);
    eq(variance, -548283.8, 'variance'); eq(Math.round(pct * 10) / 10, -91.4, 'variance %', 0.001);
    const s = await summary(ctx);
    eq(s.revenueYtd, actual, 'finance summary revenue YTD');
    return `actual ${actual} vs plan ${plan}: variance ${variance} (${pct}%). Doc deviation: the EPM > Variance screen only compares published budgets with posted EXPENSE; revenue variance is computed here from posted revenue journals`;
  });
}

// ---------------------------------------------------------------- Day 5
async function ensurePaySetup(ctx) {
  const n = N(ctx), kh = ctx.U.khalid;
  const want = { expenseAccount: ACC.salaries, payableAccount: ACC.salPay, deductionAccount: ACC.gosi };
  const lst = must(await n.get('/api/erp/pay/records/setting'), 'payroll settings');
  const cur = lst.find(s => s.code === 'defaults');
  if (cur && cur.data.expenseAccount && cur.data.payableAccount && cur.data.deductionAccount) return { cfg: cur.data, how: 'already set' };
  // Noura has no pay.setup (see notes): the admin sets the payroll accounts, as Setup would
  if (!kh) throw new Error('payroll accounts are not set and no admin client is available');
  if (cur) must(await kh.put(`/api/erp/pay/records/setting/${cur.id}`, { status: cur.status, data: Object.assign({}, cur.data, want) }), 'set payroll accounts');
  else must(await kh.post('/api/erp/pay/records/setting', { code: 'defaults', company: co(ctx), data: want }), 'create payroll accounts');
  return { cfg: want, how: 'set by Khalid (Noura lacks pay.setup)' };
}

async function day5(ctx) {
  const n = N(ctx);

  await step('U2-15', 'Payroll: open Sara\'s run, check, approve, post to the GL', async () => {
    let run;
    const saved = fromS(ctx, 'payRun');
    const runs = must(await n.get('/api/erp/pay/records/run'), 'list payroll runs');
    run = (saved && runs.find(r => r.id === saved.id || (saved.code && r.code === saved.code))) || runs.find(r => r.status === 'Calculated') || runs[0];
    if (!run) throw new Error('no payroll run found: depends on U5-17 (Sara creates and submits the October run; ctx.S.payRun)');
    eq(run.status, 'Calculated', 'run status (Pending approval)');
    eq(run.data.gross, 123850, 'run gross'); eq(run.data.net, 112759.37, 'run net pay'); eq(run.data.deductions, 11090.63, 'run GOSI deductions');
    ok(String(run.data.calculatedBy).length > 0, 'calculatedBy missing');
    ok(String(run.data.calculatedBy).toLowerCase() !== String(ctx.users.noura).toLowerCase(), 'Noura calculated the run herself');
    const setup = await ensurePaySetup(ctx);
    const ap = must(await n.post(`/api/erp/pay/runs/${run.id}/approve`, {}), 'approve run');
    eq(ap.status, 'Approved', 'status'); eq(ap.data.approvedBy, ctx.users.noura, 'approvedBy');
    refused(await n.post(`/api/erp/pay/runs/${run.id}/approve`, {}), 'approve twice');
    const posted = must(await n.post(`/api/erp/pay/runs/${run.id}/post`, {}), 'post run');
    eq(posted.status, 'Posted', 'status after posting');
    const jcode = posted.data.journal; ok(jcode, 'run has no journal code');
    const jv = (await flist(n, 'journal')).find(j => j.code === jcode);
    ok(jv, 'journal ' + jcode + ' not found'); eq(jv.status, 'Draft', 'payroll journal is drafted for Finance to post');
    const L = a => jv.data.lines.filter(l => l.account === a);
    eq(L(setup.cfg.expenseAccount).reduce((s, l) => s + toNum(l.debit), 0), 123850, 'Dr Salaries');
    eq(L(setup.cfg.payableAccount).reduce((s, l) => s + toNum(l.credit), 0), 112759.37, 'Cr Salaries payable');
    eq(L(setup.cfg.deductionAccount).reduce((s, l) => s + toNum(l.credit), 0), 11090.63, 'Cr GOSI payable');
    await fputOk(n, 'journal', jv, { status: 'Posted' }, 'post payroll journal');
    const tb = await trial(n);
    eq(tb.net(setup.cfg.expenseAccount), 123850, 'salaries expense in the trial balance');
    eq(tb.dr, tb.cr, 'trial balance balanced');
    const slips = must(await n.get('/api/erp/pay/records/payslip'), 'payslips').filter(p => p.parent === run.id);
    ok(slips.length > 0 && slips.every(p => p.status === 'Posted'), 'payslips are not all Posted');
    return `run ${run.code} Approved by ${ctx.users.noura}, posted; journal ${jcode} Dr ${setup.cfg.expenseAccount} 123,850.00 / Cr ${setup.cfg.payableAccount} 112,759.37 / Cr ${setup.cfg.deductionAccount} 11,090.63 (accounts ${setup.how}); doc says post straight to GL, API drafts a journal and Noura posts it`;
  });

  await step('U2-16', 'Reports: trial balance, VAT, payables, receivables, audit', async () => {
    const tb = await trial(n);
    eq(tb.dr, tb.cr, 'trial balance debits = credits');
    ok(tb.dr > 500000, 'trial balance looks empty');
    const out = round2(-tb.net(ACC.vatOut)), inp = tb.net(ACC.vatIn);
    eq(out, 7757.43, 'VAT output'); eq(inp, 7383, 'VAT input'); eq(round2(out - inp), 374.43, 'VAT payable');
    const s = await summary(ctx);
    eq(s.apOutstanding, 47978, 'payables open (summary)'); eq(round2(-tb.net(ACC.ap)), 47978, 'payables per GL 2100');
    eq(s.arOutstanding, 49340, 'receivables open (summary)'); eq(tb.net(ACC.ar), 49340, 'receivables per GL 1100');
    const au = must(await n.get('/api/finance/audit?limit=1000'), 'audit');
    ok(au.length > 0, 'audit empty'); ok(au.every(a => a.userName), 'an audit row has no acting user');
    const who = new Set(au.map(a => String(a.userName).toLowerCase()));
    ok(who.has(String(ctx.users.noura).toLowerCase()), 'no audit rows by Noura'); ok(who.has(String(ctx.users.khalid).toLowerCase()), 'no audit rows by Khalid (journal approval)');
    if (ctx.S.rentJournal) ok(au.some(a => a.recordId === ctx.S.rentJournal.id && a.action === 'StatusChanged' && String(a.userName).toLowerCase() === String(ctx.users.khalid).toLowerCase()), 'rent journal approval by Khalid not in audit');
    const posted = tb.journals; const ids = new Set(au.map(a => a.recordId));
    const missing = posted.filter(j => !ids.has(j.id));
    let note = '';
    if (au.length >= 1000) note = ' (audit read capped at 1000 rows)'; else eq(missing.length, 0, 'posted journals without an audit row');
    if (ctx.U.reem) refused(await ctx.U.reem.get('/api/finance/audit'), 'audit for a user without finance.audit.view');
    return `TB ${tb.dr} = ${tb.cr}; VAT payable ${round2(out - inp)} (out ${out} - in ${inp}); payables ${s.apOutstanding}; receivables ${s.arOutstanding}; ${au.length} audit rows by ${[...who].join(',')}${note}`;
  });

  await step('U2-16b', 'Bill the last 50 thermometers 632.50; PO invoice action behaviour', async () => {
    const gulf = await findPo(ctx, 'gulf', 47380);
    const closed = gulf.status === 'Received';
    const date = ctx.today;
    const r = await enterBill(ctx, { vendorName: 'Gulf Medical Imports LLC', invoiceNo: 'GMI-7741-B', net: 550, date, due: addDays(date, 45), poNo: gulf.code, poAmount: gulf.data.total, receivedAmount: gulf.data.total, notes: 'Last 50 thermometers' });
    eq(r.total, 632.5, 'second bill total'); eq(r.tax, 82.5, 'second bill VAT');
    eq(round2(46747.5 + r.total), 47380, 'order 47,380 = first bill + second bill');
    const s = await summary(ctx);
    eq(s.apOutstanding, 48610.5, 'payables after the second bill');
    // The Purchase Order screen's own "Invoice" button bills EVERYTHING received (47,380) as a DRAFT: exercise it, then discard the draft
    let note = '';
    if (!closed) note = `PO status is ${gulf.status}, not Received: PO invoice action not exercised`;
    else {
      const inv = must(await N(ctx).post(`/api/erp/proc/pos/${gulf.id}/invoice`, {}), 'PO invoice action');
      eq(inv.status, 'Invoiced', 'PO status after invoice');
      const draft = (await flist(N(ctx), 'apinvoice')).find(b => b.code === inv.data.invoice);
      ok(draft, 'draft bill from the PO not found'); eq(draft.status, 'Draft', 'PO bill status'); eq(draft.data.total, 47380, 'PO bill total (whole order, not the balance)');
      must(await N(ctx).del(`/api/finance/records/apinvoice/${draft.id}`), 'delete the duplicate draft');
      note = 'PO invoice button made DRAFT ' + draft.code + ' for the whole 47,380 (would double-bill after GMI-7741); discarded';
    }
    return `bill ${r.bill.code} 632.50; ${note}`;
  });

  manual('U2-X1', 'Finance screens render (sidebar, My approvals list, supplier statement / aging layout)', 'Browser-only layout check; every figure behind the screens is asserted in U2-03..U2-16');
}

module.exports = { preDay0, day0, day1, day2, day3, day4, day5 };
