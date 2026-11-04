// User 4: Reem Al-Mutairi, Commercial and Projects Manager (sales role + pos/prj/web/cus/crm/cal extras).
// Steps U4-01 .. U4-19.  Day0: U4-01 | Day1: 02-04 | Day2: 05-07 | Day3: 08-16 | Day4: 17-19.
// Everything is driven through the same API the screens use; figures are checked against the UAT document,
// and where the real product behaves differently the REAL behaviour is asserted (see u4.notes.md, "Doc deviations").
const { must, refused, eq, ok, round2, step, manual, addDays } = require('./lib');

const r2 = round2;
const num = x => Number(x);
const lc = s => String(s == null ? '' : s).toLowerCase();

// ------------------------------------------------------------------ small helpers
const reem = ctx => ctx.U.reem;
const mine = ctx => { ctx.S.u4 = ctx.S.u4 || {}; return ctx.S.u4; };       // private scratch for this script
const dep = (cond, what) => { if (!cond) throw new Error('depends on ' + what + ' (it did not complete)'); };

const erpList = async (c, mod, kind, qs = '') => must(await c.get(`/api/erp/${mod}/records/${kind}${qs}`), `list ${mod}/${kind}`);
const erpCreate = async (c, mod, kind, body) => must(await c.post(`/api/erp/${mod}/records/${kind}`, body), `create ${mod}/${kind}`);
/** PUT keeps the whole record: the server replaces `data` for most kinds, so the old data is merged with the patch here. */
const erpUpdate = async (c, mod, kind, rec, patch = {}) => must(await c.put(`/api/erp/${mod}/records/${kind}/${rec.id}`, {
  company: rec.company, branch: rec.branch, ref: rec.ref, status: patch.status || rec.status, data: { ...(rec.data || {}), ...(patch.data || {}) },
}), `update ${mod}/${kind} ${rec.code}`);
const posList = async (c, kind, qs = '') => must(await c.get(`/api/pos/records/${kind}${qs}`), `list pos/${kind}`);
const byCode = (list, code) => list.find(x => x.code === code);
const kpi = (sum, k) => { const x = (sum.kpis || []).find(y => y.k === k); return x ? num(x.v) : NaN; };
const listRows = (sum, k) => ((sum.lists || []).find(y => y.k === k) || { rows: [] }).rows;

const quoteTotals = (lines, taxPct, orderDiscountPct = 0) => {
  const gross = lines.reduce((s, l) => s + num(l.qty) * num(l.price) * (1 - num(l.discountPct || 0) / 100), 0);
  const discount = r2(gross * orderDiscountPct / 100);
  const net = r2(gross - discount);
  const tax = r2(net * taxPct / 100);
  return { subtotal: r2(gross), net, discount, tax, total: r2(net + tax) };
};

/** Finance customer code for a company: Noura's own customer (ctx.S.customers) first, then any finance customer with that name, then the CRM account code. */
async function finCustomer(ctx, keyword, fallback) {
  const c = ctx.S.customers;
  try {
    if (Array.isArray(c)) {
      for (const x of c) {
        if (typeof x === 'string') { if (lc(x).includes(keyword)) return x; continue; }
        if (x && lc(JSON.stringify(x)).includes(keyword)) { const code = x.code || x.Code || x.customer; if (code) return code; }
      }
    } else if (c && typeof c === 'object') {
      for (const [k, v] of Object.entries(c)) {
        if (!lc(k).includes(keyword) && !lc(JSON.stringify(v)).includes(keyword)) continue;
        const code = typeof v === 'string' ? v : (v && (v.code || v.Code));
        if (code) return code;
      }
    }
  } catch { /* fall through */ }
  try {
    const rows = await reem(ctx).get('/api/finance/records/customer');
    if (rows.ok && Array.isArray(rows.data)) {
      const hits = rows.data.filter(x => lc(x.data && x.data.name).includes(keyword));
      const own = hits.find(x => !(x.data && x.data.fromCrm)) || hits[0];
      if (own) return own.code;
    }
  } catch { /* fall through */ }
  return fallback;
}

// ------------------------------------------------------------------ master data of this script
const PRODUCTS = [
  { sku: 'SM-3PLY',   name: 'Surgical mask 3-ply, box of 50',  cost: 8,  price: 15, barcode: '6281000000011', start: 40 },
  { sku: 'GLV-NIT-M', name: 'Nitrile gloves M, box of 100',    cost: 14, price: 26, barcode: '6281000000012', start: 20 },
  { sku: 'SYR-5ML',   name: 'Syringe 5 ml, box of 100',        cost: 18, price: 34, barcode: '6281000000013', start: 10 },
  { sku: 'THERM-DIG', name: 'Digital thermometer',             cost: 11, price: 25, barcode: '6281000000014', start: 10 },
];
const MAJED_EMAIL = 'majed.alsabti@example.com';

// ================================================================== DAY 0
async function day0(ctx) {
  const c = reem(ctx);
  const DMM = ctx.branch.DMM;

  await step('U4-01', 'POS setup: store DMM, terminal T1, VAT 15%, 4 products with barcodes, 10% off SYR-5ML', async () => {
    // --- settings: VAT 15%, prices are entered WITHOUT tax (the document's totals add VAT on top: 56.00 + 8.40 = 64.40)
    const cfg = { taxRate: 15, pricesIncludeTax: false, requireShift: true, allowNegativeStock: false, maxDiscountPct: 20, pointsPerCurrency: 1, pointValue: 0.05, receiptHeader: 'Al-Noor Retail Store - Dammam', receiptFooter: 'Thank you' };
    const sets = await posList(c, 'setting');
    const cur = byCode(sets, 'pos');
    if (cur) must(await c.put(`/api/pos/records/setting/${cur.id}`, { company: cur.company || ctx.company, branch: cur.branch, status: 'Active', data: { ...cur.data, ...cfg } }), 'update POS settings');
    else must(await c.post('/api/pos/records/setting', { code: 'pos', company: ctx.company, status: 'Active', data: cfg }), 'create POS settings');
    // --- terminal T1 of store DMM
    const regs = await posList(c, 'register');
    if (!regs.find(x => x.code === 'T1' && x.branch === DMM))
      must(await c.post('/api/pos/records/register', { code: 'T1', company: ctx.company, branch: DMM, status: 'Active', data: { name: 'Terminal 1 - Dammam store' } }), 'create terminal T1');
    // --- products: Faisal (u3) normally created them on day 0; Reem sets retail price + barcode (and creates the row if it is missing)
    const prods = await posList(c, 'product');
    const created = [];
    for (const p of PRODUCTS) {
      const cur2 = byCode(prods, p.sku);
      if (cur2) {
        must(await c.put(`/api/pos/records/product/${cur2.id}`, { company: cur2.company, branch: cur2.branch, status: 'Active',
          data: { ...cur2.data, price: p.price, barcode: p.barcode, trackStock: true, cost: num(cur2.data && cur2.data.cost) || p.cost } }), 'update product ' + p.sku);
      } else {
        must(await c.post('/api/pos/records/product', { code: p.sku, company: ctx.company, status: 'Active',
          data: { name: p.name, price: p.price, cost: p.cost, barcode: p.barcode, trackStock: true, category: 'Trade', reorder: 5 } }), 'create product ' + p.sku);
        created.push(p.sku);
      }
    }
    // --- promotion: 10% off SYR-5ML
    const promos = await posList(c, 'promotion');
    let promo = promos.find(x => x.data && x.data.type === 'pct' && x.data.scope === 'sku' && lc(x.data.target) === 'syr-5ml');
    if (!promo) promo = must(await c.post('/api/pos/records/promotion', { company: ctx.company, status: 'Active', data: { name: '10% off syringes', type: 'pct', scope: 'sku', target: 'SYR-5ML', value: 10 } }), 'create promotion');
    // --- verify what the terminal will see
    const after = await posList(c, 'product');
    for (const p of PRODUCTS) {
      const row = byCode(after, p.sku); ok(row, `${p.sku} is not in the POS catalogue`);
      eq(row.data.price, p.price, `${p.sku} retail price`); ok(String(row.data.barcode) === p.barcode, `${p.sku} barcode is ${row.data.barcode}, expected ${p.barcode}`);
      ok(row.status !== 'Inactive', `${p.sku} is inactive`);
    }
    const pr = (await posList(c, 'promotion')).find(x => x.id === promo.id);
    ok(pr && pr.status === 'Active', 'promotion is not Active');
    const regs2 = await posList(c, 'register', `?branch=${DMM}`);
    ok(regs2.find(x => x.code === 'T1'), 'terminal T1 not listed');
    const st = mine(ctx); st.promo = promo.code;
    return `4 products with barcodes${created.length ? ' (created by Reem because Faisal had not: ' + created.join(', ') + ')' : ''}, terminal T1@${DMM}, promotion ${promo.code} Active, VAT 15% prices excl. tax`;
  });
}

// ================================================================== DAY 1
async function day1(ctx) {
  const c = reem(ctx);
  const S = mine(ctx);
  S.leads = S.leads || {};

  await step('U4-02', 'CRM leads: qualify Najd and Al-Hayat, disqualify Bayan with reason; overview counts agree', async () => {
    const setup = [
      { key: 'najd',  name: 'Hessa Al-Anazi',       company: 'Najd Pharmacy Chain',  source: 'Referral', email: 'hessa.alanazi@example.com', phone: '0500000101', value: 60000 },
      { key: 'hayat', name: 'Dr. Majed Al-Sabti',   company: 'Al-Hayat Clinics',     source: 'Web',      email: MAJED_EMAIL,                 phone: '0500000102', value: 120000 },
      { key: 'bayan', name: 'Bayan Dental Center',  company: 'Bayan Dental Center',  source: 'Walk-in',  email: 'info.bayan@example.com',    phone: '0500000103', value: 10000 },
    ];
    for (const l of setup) {
      const rec = await erpCreate(c, 'crm', 'lead', { company: ctx.company, data: { name: l.name, company: l.company, email: l.email, phone: l.phone, source: l.source, industry: 'Healthcare', value: l.value, owner: ctx.users.reem } });
      ok(rec.status === 'New', `a new lead should start as New, got ${rec.status}`);
      S.leads[l.key] = rec;
    }
    // qualify two, disqualify the third (the product's status for "disqualified" is Unqualified; the reason is kept on the lead)
    for (const k of ['najd', 'hayat']) S.leads[k] = await erpUpdate(c, 'crm', 'lead', S.leads[k], { status: 'Qualified' });
    S.leads.bayan = await erpUpdate(c, 'crm', 'lead', S.leads.bayan, { status: 'Unqualified', data: { reason: 'Budget too small', disqualifyReason: 'Budget too small' } });
    // overview agrees
    const sum = must(await c.get('/api/erp/crm/summary'), 'CRM overview');
    const rows = listRows(sum, 'leadsByStatus'); const cnt = s => num((rows.find(x => x.name === s) || {}).value || 0);
    eq(cnt('Qualified'), 2, 'overview: Qualified leads'); eq(cnt('Unqualified'), 1, 'overview: Unqualified (disqualified) leads'); eq(kpi(sum, 'leadsNew'), 0, 'overview: New leads');
    const back = (await erpList(c, 'crm', 'lead')).find(x => x.id === S.leads.bayan.id);
    ok(back && back.data.reason === 'Budget too small', 'disqualification reason was not saved');
    return 'Qualified 2, Unqualified 1 (reason kept), New 0';
  });

  await step('U4-03', 'Convert both qualified leads to accounts+contacts; opportunities 120,000 Proposal / 60,000 Negotiation; pipeline 180,000, weighted 105,000', async () => {
    dep(S.leads.najd && S.leads.hayat, 'U4-02');
    // CRM setup: pipeline stages (the probabilities per stage are fixed in the product: Proposal 50, Negotiation 75 - see deviations)
    const sets = await erpList(c, 'crm', 'setting');
    const d = sets.find(x => x.code === 'defaults');
    const cfg = { stages: 'Qualified, Proposal, Negotiation', sources: 'Web, Referral, Event, Cold call, Partner, Campaign, Walk-in', taxPct: 15 };
    if (d) await erpUpdate(c, 'crm', 'setting', d, { data: cfg }); else await erpCreate(c, 'crm', 'setting', { code: 'defaults', company: ctx.company, data: cfg });

    const plan = [
      { k: 'hayat', name: 'Al-Hayat annual supply', amount: 120000, stage: 'Proposal', prob: 50 },
      { k: 'najd',  name: 'Najd first order',       amount: 60000,  stage: 'Negotiation', prob: 75 },
    ];
    S.accounts = {}; S.contacts = {}; S.opps = {};
    for (const p of plan) {
      const lead = S.leads[p.k];
      const cv = must(await c.post(`/api/erp/crm/leads/${lead.id}/convert`, { createOpportunity: true, amount: p.amount }), 'convert lead ' + lead.code);
      ok(cv.account && cv.contact && cv.opportunity, 'convert did not return account, contact and opportunity');
      S.accounts[p.k] = { code: cv.account }; S.contacts[p.k] = { code: cv.contact };
      const op = (await erpList(c, 'crm', 'opportunity')).find(x => x.code === cv.opportunity); ok(op, 'opportunity ' + cv.opportunity + ' not found');
      S.opps[p.k] = await erpUpdate(c, 'crm', 'opportunity', op, { data: { name: p.name, amount: p.amount, stage: p.stage, probability: p.prob } });
    }
    // the converted leads
    const leads = await erpList(c, 'crm', 'lead');
    for (const k of ['najd', 'hayat']) { const l = leads.find(x => x.id === S.leads[k].id); ok(l && l.status === 'Converted', `lead ${k} is not Converted`); }
    // accounts carry the company name, contacts carry the person
    const accs = await erpList(c, 'crm', 'account'); const cts = await erpList(c, 'crm', 'contact');
    ok(lc(byCode(accs, S.accounts.hayat.code).data.name) === 'al-hayat clinics', 'account name for Al-Hayat is ' + byCode(accs, S.accounts.hayat.code).data.name);
    ok(lc(byCode(accs, S.accounts.najd.code).data.name) === 'najd pharmacy chain', 'account name for Najd is wrong');
    ok(byCode(cts, S.contacts.najd.code).data.name === 'Hessa Al-Anazi', 'Najd contact should be Hessa Al-Anazi');
    ok(byCode(cts, S.contacts.hayat.code).data.name === 'Dr. Majed Al-Sabti', 'Al-Hayat contact should be Dr. Majed Al-Sabti');
    const sum = must(await c.get('/api/erp/crm/summary'), 'CRM overview');
    eq(kpi(sum, 'openCount'), 2, 'open opportunities'); eq(kpi(sum, 'pipeline'), 180000, 'pipeline'); eq(kpi(sum, 'weighted'), 105000, 'weighted pipeline');
    const stg = listRows(sum, 'byStage'); const st = n => num((stg.find(x => x.name === n) || {}).value || 0);
    eq(st('Proposal'), 120000, 'pipeline at Proposal'); eq(st('Negotiation'), 60000, 'pipeline at Negotiation');
    ctx.S.crm = { accounts: S.accounts, contacts: S.contacts, opportunities: Object.fromEntries(Object.entries(S.opps).map(([k, v]) => [k, { id: v.id, code: v.code }])) };
    return `accounts ${S.accounts.hayat.code}/${S.accounts.najd.code}; pipeline 180,000, weighted 105,000`;
  });

  await step('U4-04', 'Activities: call with Hessa (15 min) and meeting with Dr. Majed 2026-10-14 14:00; also in Reem\'s calendar', async () => {
    dep(S.opps && S.opps.najd && S.opps.hayat, 'U4-03');
    const call = await erpCreate(c, 'crm', 'activity', { company: ctx.company, ref: S.accounts.najd.code, data: { type: 'Call', subject: 'Call with Hessa Al-Anazi (15 min)', opportunity: S.opps.najd.code, contact: S.contacts.najd.code, due: ctx.today, duration: 15, owner: ctx.users.reem } });
    S.call = await erpUpdate(c, 'crm', 'activity', call, { status: 'Done', data: { doneAt: ctx.today } });
    const meet = await erpCreate(c, 'crm', 'activity', { company: ctx.company, ref: S.accounts.hayat.code, data: { type: 'Meeting', subject: 'Meeting with Dr. Majed Al-Sabti', opportunity: S.opps.hayat.code, contact: S.contacts.hayat.code, due: '2026-10-14', time: '14:00', duration: 60, owner: ctx.users.reem } });
    S.meeting = meet;
    // timeline per opportunity
    const acts = await erpList(c, 'crm', 'activity');
    const tl = code => acts.filter(a => a.data && a.data.opportunity === code);
    ok(tl(S.opps.najd.code).some(a => a.data.type === 'Call' && num(a.data.duration) === 15 && a.status === 'Done'), 'call (15 min) is not on the Najd opportunity timeline');
    ok(tl(S.opps.hayat.code).some(a => a.data.type === 'Meeting' && a.data.due === '2026-10-14' && a.data.time === '14:00'), 'meeting is not on the Al-Hayat opportunity timeline');
    // The CRM activity does not create a calendar entry by itself (see deviations): book the same meeting in Reem's calendar, 14:00 Riyadh = 11:00 UTC
    const ev = must(await c.post('/api/calendar/events', { kind: 'event', title: 'Meeting with Dr. Majed Al-Sabti (Al-Hayat Clinics)', start: '2026-10-14T11:00:00Z', end: '2026-10-14T12:00:00Z', location: 'Dammam store', notes: 'CRM activity ' + S.meeting.code }), 'calendar event');
    S.calEvent = ev.ev;
    const list = must(await c.get('/api/calendar/events?from=2026-10-14T00:00:00Z&to=2026-10-15T00:00:00Z'), 'calendar list');
    ok(list.some(e => e.id === ev.ev.id && /^2026-10-14T11:00:00/.test(e.start)), 'meeting is not in Reem\'s calendar at 11:00 UTC (14:00 Riyadh)');
    return `activities ${S.call.code} (Done) and ${S.meeting.code} on the opportunity timelines; calendar event booked separately`;
  });
}

// ================================================================== DAY 2
async function day2(ctx) {
  const c = reem(ctx);
  const S = mine(ctx);
  S.quotes = S.quotes || {};

  await step('U4-05', 'Quotes Q-1001 / Q-1002 accepted; totals 17,250 / 14,490; both opportunities Won', async () => {
    dep(S.accounts && S.opps, 'U4-03');
    const defs = [
      { k: 'hayat', code: 'Q-1001', valid: addDays(ctx.today, 14), lines: [
        { sku: 'SM-3PLY', desc: 'Surgical mask 3-ply, box of 50', qty: 500, price: 12, discountPct: 0 },
        { sku: 'GLV-NIT-M', desc: 'Nitrile gloves M, box of 100', qty: 300, price: 20, discountPct: 0 },
        { sku: 'GOWN-10', desc: 'Isolation gown, pack of 10', qty: 40, price: 75, discountPct: 0 }], sub: 15000, vat: 2250, total: 17250 },
      { k: 'najd', code: 'Q-1002', valid: addDays(ctx.today, 14), lines: [
        { sku: 'SYR-5ML', desc: 'Syringe 5 ml, box of 100', qty: 400, price: 27, discountPct: 0 },
        { sku: 'THERM-DIG', desc: 'Digital thermometer', qty: 100, price: 18, discountPct: 0 }], sub: 12600, vat: 1890, total: 14490 },
    ];
    const out = [];
    for (const q of defs) {
      const t = quoteTotals(q.lines, 15, 0);
      eq(t.subtotal, q.sub, q.code + ' subtotal (calculated from lines)'); eq(t.tax, q.vat, q.code + ' VAT'); eq(t.total, q.total, q.code + ' total');
      const rec = await erpCreate(c, 'crm', 'quote', { code: q.code, company: ctx.company, ref: S.accounts[q.k].code,
        data: { opportunity: S.opps[q.k].code, date: ctx.today, validUntil: q.valid, taxPct: 15, discountPct: 0, lines: q.lines, subtotal: t.subtotal, tax: t.tax, total: t.total } });
      ok(rec.code === q.code, `quote code is ${rec.code}, expected ${q.code}`);
      let cur = await erpUpdate(c, 'crm', 'quote', rec, { status: 'Sent' });
      cur = await erpUpdate(c, 'crm', 'quote', cur, { status: 'Accepted' });
      ok(cur.status === 'Accepted', 'quote not Accepted');
      S.quotes[q.k] = { rec: cur, def: q, totals: t };
      // win the opportunity
      const won = must(await c.post(`/api/erp/crm/opportunities/${S.opps[q.k].id}/won`, {}), 'win ' + S.opps[q.k].code);
      ok(won.status === 'Won', `opportunity ${S.opps[q.k].code} status is ${won.status}`);
      eq(won.data.probability, 100, 'won probability');
      out.push(`${q.code} ${t.subtotal}+${t.tax}=${t.total}`);
    }
    // both won; pipeline now empty; finance customers exist for the accounts so they can be invoiced
    const sum = must(await c.get('/api/erp/crm/summary'), 'CRM overview');
    eq(kpi(sum, 'openCount'), 0, 'open opportunities after winning'); eq(kpi(sum, 'pipeline'), 0, 'pipeline after winning'); eq(kpi(sum, 'winRate'), 100, 'win rate');
    ctx.S.quotes = { hayat: { code: 'Q-1001', total: 17250, subtotal: 15000, vat: 2250, account: S.accounts.hayat.code }, najd: { code: 'Q-1002', total: 14490, subtotal: 12600, vat: 1890, account: S.accounts.najd.code } };
    return out.join('; ') + '; both opportunities Won, win rate 100%';
  });

  await step('U4-06', 'Sales documents: order workflow per quote + draft receivable invoice with the same totals', async () => {
    dep(S.quotes && S.quotes.hayat && S.quotes.najd, 'U4-05');
    // 1) the Sales Order (Order-to-Cash) document flow
    const defs = must(await c.get('/api/definitions'), 'definitions');
    const def = defs.find(d => /sales order/i.test(d.name || '') && d.isPublished !== false);
    ok(def, 'workflow "ERP - Sales Order (Order-to-Cash)" not found in the definitions list');
    ctx.S.salesOrders = [];
    const made = [];
    for (const k of ['hayat', 'najd']) {
      const q = S.quotes[k]; const lines = q.def.lines;
      const initialData = { docType: 'SO', docNumber: 'SO-' + q.def.code.replace('Q-', ''), module: 'sales', company: ctx.company, branch: ctx.branch.JED, warehouse: 'JED-MAIN', docDate: ctx.today,
        party: k === 'hayat' ? 'Al-Hayat Clinics' : 'Najd Pharmacy Chain', currency: 'SAR', notes: 'From quote ' + q.def.code,
        lines: lines.map(l => ({ item: l.sku, description: l.desc, qty: l.qty, unit: 'box', unitPrice: l.price, amount: r2(l.qty * l.price) })),
        subtotal: q.totals.subtotal, discountPct: 0, discountAmount: 0, vatPct: 15, vatAmount: q.totals.tax, total: q.totals.total, requesterName: 'Reem Al-Mutairi' };
      const inst = must(await c.post('/api/instances/start', { definitionId: def.id, initialData }), 'start sales order for ' + q.def.code);
      ok(inst.id, 'no instance id');
      ok(/running/i.test(String(inst.status)), `sales order instance status is ${inst.status}, expected Running (waiting at Credit Check)`);
      eq(inst.data && inst.data.total, q.totals.total, 'sales order total on the document');
      ctx.S.salesOrders.push({ quote: q.def.code, instanceId: inst.id, docNumber: initialData.docNumber, total: q.totals.total, customerName: initialData.party });
      made.push(`${initialData.docNumber}=${q.totals.total}`);
    }
    // 2) receivable invoices (the order flow only logs the GL posting, it creates no invoice record - see deviations)
    ctx.S.arInvoices = [];
    for (const k of ['hayat', 'najd']) {
      const q = S.quotes[k];
      const cust = await finCustomer(ctx, k === 'hayat' ? 'hayat' : 'najd', S.accounts[k].code);
      const terms = k === 'hayat' ? 60 : 30;
      const inv = must(await c.post('/api/finance/records/arinvoice', { company: ctx.company, status: 'Draft', data: {
        customer: cust, date: ctx.today, dueDate: addDays(ctx.today, terms), currency: '', rate: 1, amount: q.totals.net, taxAmount: q.totals.tax, total: q.totals.total, paid: 0,
        quote: q.def.code, notes: 'Invoice for quote ' + q.def.code,
        lines: q.def.lines.map(l => ({ description: `${l.sku} ${l.desc}`, qty: l.qty, price: l.price, amount: r2(l.qty * l.price) })) } }), 'create invoice for ' + q.def.code);
      eq(inv.data.total, q.totals.total, 'invoice total'); ok(inv.status === 'Draft', 'invoice should start as Draft');
      ctx.S.arInvoices.push({ code: inv.code, id: inv.id, customer: cust, total: q.totals.total, net: q.totals.net, tax: q.totals.tax, quote: q.def.code, status: 'Draft' });
    }
    // 3) receivables list shows them with the same totals
    const ar = must(await c.get('/api/finance/records/arinvoice'), 'receivables');
    for (const i of ctx.S.arInvoices) { const row = ar.find(x => x.code === i.code); ok(row, `invoice ${i.code} not in receivables`); eq(row.data.total, i.total, `receivable ${i.code} total`); }
    return `orders ${made.join(', ')}; draft invoices ${ctx.S.arInvoices.map(i => i.code + '=' + i.total).join(', ')}`;
  });

  await step('U4-06b', 'Negative: Reem cannot post to the general ledger or read payroll', async () => {
    refused(await c.post('/api/finance/records/journal', { status: 'Draft', data: { date: ctx.today, memo: 'x', lines: [] } }), 'journal create by Reem');
    refused(await c.get('/api/erp/pay/records/run'), 'payroll runs read by Reem');
    return 'journal create and payroll list refused';
  });

  await step('U4-07', 'Campaign "October PPE offer", budget 2,000, 3 recipients, spend 0 of 2,000', async () => {
    dep(S.contacts && S.contacts.hayat, 'U4-03');
    // third CRM contact: Bayan (the disqualified lead was never converted, so the contact is added by hand)
    let bay = (await erpList(c, 'crm', 'contact')).find(x => x.data && x.data.name === 'Bayan Dental Center');
    if (!bay) bay = await erpCreate(c, 'crm', 'contact', { company: ctx.company, data: { name: 'Bayan Dental Center', email: 'info.bayan@example.com', phone: '0500000103', title: 'Reception' } });
    const recipients = [S.contacts.najd.code, S.contacts.hayat.code, bay.code];
    const cmp = await erpCreate(c, 'crm', 'campaign', { company: ctx.company, status: 'Active', data: { name: 'October PPE offer', type: 'Email', start: ctx.today, end: addDays(ctx.today, 30), budget: 2000, spent: 0, recipients, recipientCount: recipients.length, notes: 'PPE offer to CRM contacts' } });
    const back = (await erpList(c, 'crm', 'campaign')).find(x => x.id === cmp.id);
    eq(back.data.recipients.length, 3, 'recipients'); eq(back.data.budget, 2000, 'budget'); eq(back.data.spent, 0, 'spend');
    ok(back.status === 'Active', 'campaign should be Active');
    return `campaign ${cmp.code}: 3 recipients (${recipients.join(', ')}), spend 0 of 2000 (recipients are stored on the campaign, the product has no send engine)`;
  });
}

// ================================================================== DAY 3
async function day3(ctx) {
  const c = reem(ctx);
  const S = mine(ctx);
  const DMM = ctx.branch.DMM;
  const P = (S.pos = S.pos || {});
  const base = { company: ctx.company, branch: DMM, register: 'T1' };
  const stockOf = async sku => {
    const rows = await posList(c, 'stock', `?branch=${DMM}`);
    const r = rows.find(x => x.branch === DMM && x.data && x.data.sku === sku);
    return r ? num(r.data.qty) : 0;
  };
  const dataOf = r => r.data || {};

  await step('U4-08', 'POS shift: selling without a shift is refused; open shift on T1 with 500.00', async () => {
    // (a) make sure the shop has the stock Faisal moves on day 2 (40/20/10/10); top up only if it is short
    const topped = [];
    for (const p of PRODUCTS) {
      const have = await stockOf(p.sku);
      if (have < p.start) {
        must(await c.post('/api/pos/stock/adjust', { company: ctx.company, branch: DMM, sku: p.sku, delta: p.start - have, reason: 'UAT opening stock for the shop (transfer not found)' }), 'stock adjust ' + p.sku);
        topped.push(`${p.sku}+${p.start - have}`);
      }
    }
    P.before = {}; for (const p of PRODUCTS) P.before[p.sku] = await stockOf(p.sku);
    // (b) no shift yet -> refused
    refused(await c.post('/api/pos/sales/checkout', { ...base, lines: [{ sku: 'SM-3PLY', qty: 1 }], payments: [{ method: 'cash', amount: 50 }] }), 'sale without shift', [400]);
    // (c) open
    const sh = must(await c.post('/api/pos/shifts/open', { ...base, openingCash: 500 }), 'open shift');
    ok(sh.status === 'Open', 'shift status ' + sh.status); eq(sh.data.opening, 500, 'opening cash');
    P.shift = sh;
    const cur = must(await c.get('/api/pos/shifts/current?register=T1'), 'current shift'); ok(cur && cur.id === sh.id, 'current shift is not the one just opened');
    refused(await c.post('/api/pos/shifts/open', { ...base, openingCash: 100 }), 'second shift', [409]);
    return `shift ${sh.code} Open, drawer 500.00` + (topped.length ? `; stock topped up: ${topped.join(', ')}` : '; shop stock already present');
  });

  await step('U4-09', 'Sale 1: SM x2 + GLV x1, cash 70.00 -> 56.00 + 8.40 = 64.40, change 5.60', async () => {
    dep(P.shift, 'U4-08');
    const s = must(await c.post('/api/pos/sales/checkout', { ...base, lines: [{ sku: 'SM-3PLY', qty: 2 }, { sku: 'GLV-NIT-M', qty: 1 }], payments: [{ method: 'cash', amount: 70 }] }), 'checkout 1');
    const d = dataOf(s);
    eq(d.subtotal, 56, 'subtotal'); eq(d.tax, 8.4, 'VAT'); eq(d.total, 64.4, 'total'); eq(d.change, 5.6, 'change'); eq(d.tendered, 70, 'tendered'); eq(d.discount, 0, 'discount');
    ok(s.status === 'Completed', 'sale status ' + s.status);
    ok(Array.isArray(d.lines) && d.lines.length === 2 && d.lines.every(l => l.name && l.price != null), 'receipt lines incomplete');
    ok(s.code && d.cashier && d.date, 'receipt header (number, cashier, date) incomplete');
    P.sale1 = s;
    // extra rule checks on the same terminal
    refused(await c.post('/api/pos/sales/checkout', { ...base, lines: [{ sku: 'SM-3PLY', qty: 1 }], payments: [{ method: 'cash', amount: 1 }] }), 'underpayment', [400]);
    refused(await c.post('/api/pos/sales/checkout', { ...base, lines: [{ sku: 'SM-3PLY', qty: 1, discountPct: 50 }], payments: [{ method: 'cash', amount: 50 }] }), 'manual discount above the limit', [400, 403]);
    return `receipt ${s.code}: subtotal 56.00, VAT 8.40, total 64.40, change 5.60`;
  });

  await step('U4-10', 'Sale 2: SYR x2 + THERM x1 by card -> SYR line 61.20 after 10% promo, VAT 12.93, total 99.13', async () => {
    dep(P.shift, 'U4-08');
    const s = must(await c.post('/api/pos/sales/checkout', { ...base, lines: [{ sku: 'SYR-5ML', qty: 2 }, { sku: 'THERM-DIG', qty: 1 }], payments: [{ method: 'card', amount: 99.13, ref: 'UAT-CARD-1' }] }), 'checkout 2');
    const d = dataOf(s);
    const syr = d.lines.find(l => l.sku === 'SYR-5ML'); const th = d.lines.find(l => l.sku === 'THERM-DIG');
    ok(syr.promo, 'no promotion code on the SYR line'); eq(syr.promoDisc, 6.8, 'SYR promotion 10% of 68.00');
    eq(syr.total - syr.tax, 61.2, 'SYR line net after promotion (excl. VAT)');
    eq(d.discount, 6.8, 'discount total');
    // the API reports the subtotal BEFORE discount (93.00); the document's 86.20 is that subtotal less the 6.80 discount
    eq(d.subtotal, 93, 'subtotal before discount'); eq(r2(d.subtotal - d.discount), 86.2, 'subtotal after discount (document: 86.20)');
    eq(d.tax, 12.93, 'VAT'); eq(d.total, 99.13, 'total'); eq(d.change, 0, 'change');
    P.sale2 = s;
    return `receipt ${s.code}: net 86.20 (93.00 less 6.80 promo) + VAT 12.93 = 99.13, card`;
  });

  await step('U4-11', 'Refund 1 glove box from sale 1 (cash) = 29.90 (26.00 + 3.90 VAT), stock +1', async () => {
    dep(P.sale1, 'U4-09');
    const before = await stockOf('GLV-NIT-M');
    const rt = must(await c.post(`/api/pos/sales/${P.sale1.id}/return`, { lines: [{ sku: 'GLV-NIT-M', qty: 1 }], method: 'cash', reason: 'Customer returned one box' }), 'return');
    const d = dataOf(rt);
    ok(d.type === 'Return', 'return record type ' + d.type); eq(d.total, -29.9, 'refund total'); eq(d.tax, -3.9, 'refund VAT'); ok(d.method === 'cash', 'refund method');
    eq(await stockOf('GLV-NIT-M'), before + 1, 'glove stock after refund');
    const orig = (await posList(c, 'sale')).find(x => x.id === P.sale1.id);
    ok(orig.status === 'PartlyReturned', 'original sale status is ' + orig.status);
    const g = orig.data.lines.find(l => l.sku === 'GLV-NIT-M'); eq(g.returned, 1, 'returned quantity on the original sale');
    refused(await c.post(`/api/pos/sales/${P.sale1.id}/return`, { lines: [{ sku: 'GLV-NIT-M', qty: 1 }], method: 'cash' }), 'return more than sold', [400]);
    P.ret = rt;
    return `return ${rt.code} -29.90 (VAT -3.90), glove stock ${before} -> ${before + 1}`;
  });

  await step('U4-12', 'Close shift counting 530.00: expected 534.50, variance -4.50; Z-report 116.20 + 17.43 = 133.63; shop stock 38/20/8/9', async () => {
    dep(P.shift && P.sale1 && P.sale2 && P.ret, 'U4-08..U4-11');
    const cl = must(await c.post(`/api/pos/shifts/${P.shift.id}/close`, { countedCash: 530, note: 'UAT close' }), 'close shift');
    const d = dataOf(cl);
    ok(cl.status === 'Closed', 'shift status ' + cl.status);
    eq(d.expected, 534.5, 'expected cash'); eq(d.counted, 530, 'counted cash'); eq(d.variance, -4.5, 'cash variance (flagged)');
    // Z-report from the shift totals
    const gross = r2(num(d.salesTotal) - num(d.returnsTotal)); const vat = r2(num(d.salesTax) - num(d.returnsTax));
    eq(gross, 133.63, 'Z total'); eq(vat, 17.43, 'Z VAT'); eq(r2(gross - vat), 116.2, 'Z net sales');
    eq(r2(num(d.cashSales) - num(d.refundCash || 0)), 34.5, 'Z cash (64.40 taken less 29.90 refunded)'); eq(d.cardSales, 99.13, 'Z card');
    eq(d.salesCount, 2, 'sales count'); eq(d.returnCount, 1, 'return count');
    refused(await c.post(`/api/pos/shifts/${P.shift.id}/close`, { countedCash: 530 }), 'close twice', [400]);
    // stock left in the shop
    const left = {}; for (const p of PRODUCTS) left[p.sku] = await stockOf(p.sku);
    const sold = { 'SM-3PLY': 2, 'GLV-NIT-M': 0, 'SYR-5ML': 2, 'THERM-DIG': 1 };
    for (const p of PRODUCTS) eq(left[p.sku], P.before[p.sku] - sold[p.sku], p.sku + ' shop stock vs. opening');
    const exact = PRODUCTS.every(p => P.before[p.sku] === p.start);
    if (exact) { eq(left['SM-3PLY'], 38, 'SM stock'); eq(left['GLV-NIT-M'], 20, 'GLV stock'); eq(left['SYR-5ML'], 8, 'SYR stock'); eq(left['THERM-DIG'], 9, 'THERM stock'); }
    ctx.S.posShift = { shift: cl.code, shiftId: cl.id, sales: [P.sale1.code, P.sale2.code], refund: P.ret.code, z: { net: 116.2, vat: 17.43, total: 133.63, cash: 34.5, card: 99.13 }, variance: -4.5, expectedCash: 534.5, counted: 530, journal: d.journal || null, branch: DMM };
    return `expected 534.50, variance -4.50, Z 116.20+17.43=133.63 (cash 34.50, card 99.13); shop ${left['SM-3PLY']}/${left['GLV-NIT-M']}/${left['SYR-5ML']}/${left['THERM-DIG']}${exact ? '' : ' (opening stock differed from 40/20/10/10, deltas checked)'}; journal ${d.journal || 'not drafted (no finance defaults)'}`;
  });

  await step('U4-12b', 'POS overview for today: sales 163.53, returns 29.90, 2 sales, variance -4.50, cash 64.40 / card 99.13', async () => {
    dep(ctx.S.posShift, 'U4-12');
    const sm = must(await c.get(`/api/pos/summary?branch=${DMM}`), 'POS summary');
    eq(sm.salesToday, 163.53, 'summary: sales today'); eq(sm.returnsToday, 29.9, 'summary: returns today'); eq(sm.countToday, 2, 'summary: sale count'); eq(sm.openShifts, 0, 'summary: open shifts');
    eq(sm.cashVariance, -4.5, 'summary: cash variance');
    const pay = n => num(((sm.payments || []).find(x => x.name === n) || {}).value || 0);
    eq(pay('cash'), 64.4, 'summary: cash taken (after change)'); eq(pay('card'), 99.13, 'summary: card');
    return 'POS overview agrees with the shift';
  });

  // ---------------------------------------------------------------- projects
  const clientProj = () => S.project;
  await step('U4-13', 'Project "Al-Hayat Clinic Fit-out": budget 80,000, 3 tasks, 2 resources, milestone 24,000', async () => {
    const acct = S.accounts && S.accounts.hayat ? S.accounts.hayat.code : null;
    const cust = await finCustomer(ctx, 'hayat', acct);
    ok(cust, 'no finance customer for Al-Hayat Clinics (needs U4-05 or Noura\'s customer list)');
    const pr = await erpCreate(c, 'prj', 'project', { company: ctx.company, status: 'Active', data: {
      name: 'Al-Hayat Clinic Fit-out', customer: cust, manager: ctx.users.reem, start: '2026-10-14', end: '2026-12-14', billingModel: 'milestone', contractValue: 80000,
      lines: [{ category: 'Labor', amount: 30000 }, { category: 'Material', amount: 40000 }, { category: 'Other', amount: 10000 }], notes: 'Fit-out of the Al-Hayat clinic' } });
    ok(pr.status === 'Active', 'project status ' + pr.status);
    S.project = pr; S.project.customerCode = cust;
    S.tasks = {};
    for (const [n, assignee] of [['Design', ctx.users.reem], ['Procurement', ctx.users.faisal], ['Installation', ctx.users.faisal]]) {
      S.tasks[n] = await erpCreate(c, 'prj', 'task', { company: ctx.company, ref: pr.code, data: { name: n, assignee, start: '2026-10-14', due: '2026-12-14', estimate: n === 'Design' ? 24 : 40 } });
    }
    S.alloc = {};
    for (const [u, role, rate] of [['reem', 'Project manager', 200], ['faisal', 'Procurement and installation lead', 150]])
      S.alloc[u] = await erpCreate(c, 'prj', 'allocation', { company: ctx.company, ref: pr.code, data: { employee: ctx.users[u], role, pct: 50, from: '2026-10-14', to: '2026-12-14', costRate: rate, billRate: rate } });
    S.ms = await erpCreate(c, 'prj', 'milestone', { company: ctx.company, ref: pr.code, data: { name: 'Design sign-off', due: '2026-10-31', pct: 30, amount: 24000 } });
    // checks
    const tasks = (await erpList(c, 'prj', 'task')).filter(t => t.ref === pr.code); eq(tasks.length, 3, 'tasks');
    const al = (await erpList(c, 'prj', 'allocation')).filter(t => t.ref === pr.code); eq(al.length, 2, 'resources');
    const ms = (await erpList(c, 'prj', 'milestone')).filter(t => t.ref === pr.code); eq(ms.length, 1, 'milestones'); eq(ms[0].data.amount, 24000, 'milestone amount');
    eq(num(ms[0].data.pct) / 100 * 80000, 24000, 'milestone = 30% of budget');
    const budget = pr.data.lines.reduce((s, l) => s + num(l.amount), 0); eq(budget, 80000, 'budget (sum of budget lines)');
    ctx.S.project = { id: pr.id, code: pr.code, name: pr.data.name, customer: cust, budget: 80000, milestone: { id: S.ms.id, code: S.ms.code, amount: 24000 }, tasks: Object.keys(S.tasks), resources: [ctx.users.reem, ctx.users.faisal], invoice: null };
    return `${pr.code} Active, budget 80,000, 3 tasks, 2 resources (200/150 per h), milestone ${S.ms.code} 24,000; customer ${cust}`;
  });

  await step('U4-14', 'Timesheets Faisal 16 h + Reem 8 h on Design, approved; cost 5,500; labour 4,000, total 9,500 = 11.9% of budget', async () => {
    dep(clientProj(), 'U4-13');
    const pr = clientProj();
    const rows = [['faisal', 16, 150], ['reem', 8, 200]];
    S.ts = [];
    for (const [u, h, rate] of rows) {
      let t = await erpCreate(c, 'prj', 'timesheet', { company: ctx.company, ref: pr.code, data: { date: ctx.today, employee: ctx.users[u], task: 'Design', hours: h, billable: true, rate, costRate: rate, notes: 'Design work' } });
      ok(t.status === 'Draft', 'timesheet should start as Draft');
      t = await erpUpdate(c, 'prj', 'timesheet', t, { status: 'Submitted' });
      t = await erpUpdate(c, 'prj', 'timesheet', t, { status: 'Approved' });
      ok(t.status === 'Approved', 'timesheet not Approved: ' + t.status);
      S.ts.push(t);
    }
    const cost = await erpCreate(c, 'prj', 'cost', { company: ctx.company, ref: pr.code, data: { date: ctx.today, type: 'Material', description: 'Fit-out materials', amount: 5500, billable: true, markupPct: 0 } });
    S.cost = cost;
    // figures
    const sheets = (await erpList(c, 'prj', 'timesheet')).filter(t => t.ref === pr.code && t.status === 'Approved');
    const labour = r2(sheets.reduce((s, t) => s + num(t.data.hours) * num(t.data.costRate), 0));
    const costs = (await erpList(c, 'prj', 'cost')).filter(t => t.ref === pr.code).reduce((s, t) => s + num(t.data.amount), 0);
    eq(sheets.reduce((s, t) => s + num(t.data.hours), 0), 24, 'approved hours'); eq(labour, 4000, 'labour cost (2,400 + 1,600)'); eq(costs, 5500, 'materials cost');
    eq(labour + costs, 9500, 'total cost'); eq(Math.round((labour + costs) / 80000 * 1000) / 10, 11.9, 'cost as % of budget');
    const sm = must(await c.get('/api/erp/prj/summary'), 'project overview');
    eq(kpi(sm, 'budget'), 80000, 'overview budget'); eq(kpi(sm, 'actual'), 9500, 'overview actual cost'); eq(kpi(sm, 'pendingTimesheets'), 0, 'timesheets waiting for approval');
    return 'labour 4,000 (2,400 + 1,600) + materials 5,500 = 9,500 = 11.9% of 80,000';
  });

  await step('U4-15', 'Billing: milestone Design sign-off 24,000 + VAT 3,600 = 27,600, due 60 days, draft invoice in receivables', async () => {
    dep(clientProj() && S.ms, 'U4-13');
    const pr = clientProj();
    // nothing is ready until the milestone is achieved
    refused(await c.post(`/api/erp/prj/projects/${pr.id}/bill`, { taxPct: 15, date: ctx.today, termsDays: 60 }), 'billing before the milestone is achieved', [400]);
    const ach = await erpUpdate(c, 'prj', 'milestone', S.ms, { status: 'Achieved', data: { achievedAt: ctx.today } });
    ok(ach.status === 'Achieved', 'milestone not Achieved');
    const b = must(await c.post(`/api/erp/prj/projects/${pr.id}/bill`, { taxPct: 15, date: ctx.today, termsDays: 60 }), 'bill project');
    eq(b.net, 24000, 'net'); eq(b.tax, 3600, 'VAT'); eq(b.total, 27600, 'total'); ok(b.invoice, 'no invoice code returned');
    const inv = (must(await c.get('/api/finance/records/arinvoice'), 'receivables')).find(x => x.code === b.invoice); ok(inv, `invoice ${b.invoice} not in receivables`);
    ok(inv.status === 'Draft', 'project invoice should be a DRAFT, it is ' + inv.status); eq(inv.data.total, 27600, 'invoice total');
    ok(inv.data.dueDate === addDays(ctx.today, 60), `due date is ${inv.data.dueDate}, expected ${addDays(ctx.today, 60)}`);
    const pcust = pr.customer || pr.customerCode || (pr.data && pr.data.customer); ok(inv.data.customer === pcust, `invoice customer ${inv.data.customer}, project customer ${pcust}`); ok(inv.data.project === pr.code, 'invoice not linked to the project');
    const ms = (await erpList(c, 'prj', 'milestone')).find(x => x.id === S.ms.id); ok(ms.status === 'Billed', 'milestone status ' + ms.status);
    const proj = (await erpList(c, 'prj', 'project')).find(x => x.id === pr.id); eq(proj.data.billed, 24000, 'project billed to date');
    refused(await c.post(`/api/erp/prj/projects/${pr.id}/bill`, { taxPct: 15, date: ctx.today, termsDays: 60 }), 'billing the same milestone twice', [400]);
    ctx.S.project.invoice = b.invoice;
    ctx.S.projectInvoice = { code: b.invoice, id: inv.id, net: 24000, tax: 3600, total: 27600, dueDate: inv.data.dueDate, customer: pr.customer, status: 'Draft', project: pr.code };
    return `invoice ${b.invoice} DRAFT 24,000 + 3,600 = 27,600 due ${inv.data.dueDate}`;
  });

  await step('U4-16', 'Website order: Bayan Dental Center, 5 glove boxes at 26.00 = 130.00 (+VAT 19.50 = 149.50); mark processed', async () => {
    // locate the published site (u1 saves ctx.S.web; fall back to the sites list)
    let slug = null;
    const w = ctx.S.web;
    const find = o => { if (!o || typeof o !== 'object') return null; if (typeof o.slug === 'string') return o.slug; for (const v of Object.values(o)) { const s = find(v); if (s) return s; } return null; };
    slug = find(w);
    const sites = must(await c.get('/api/website/sites'), 'sites');
    if (!slug) { const pub = sites.find(s => s.published); slug = pub && pub.slug; }
    ok(slug, 'no published website found (Khalid publishes on day 2 - ctx.S.web / sites list empty)');
    const site = sites.find(s => s.slug === slug); ok(site, 'site ' + slug + ' not in Reem\'s site list'); ok(site.published, 'site ' + slug + ' is not published');
    // did u1 already post one?
    let subs = must(await c.get(`/api/website/submissions?siteId=${site.id}&kind=order`), 'orders');
    let order = subs.find(x => /bayan/i.test(x.name));
    let posted = false;
    if (!order) {
      const r = await c.post(`/api/public/sites/${slug}/orders`, { name: 'Bayan Dental Center', email: 'info.bayan@example.com', phone: '0500000103', address: 'King Fahd Road, Dammam', note: 'UAT order from the public site', lines: [{ sku: 'GLV-NIT-M', qty: 5 }] });
      must(r, 'public order (is GLV-NIT-M on the published price list at 26.00?)'); posted = true;
      subs = must(await c.get(`/api/website/submissions?siteId=${site.id}&kind=order`), 'orders');
      order = subs.find(x => x.number === r.data.number) || subs.find(x => /bayan/i.test(x.name));
    }
    ok(order, 'the Bayan order is not in the orders list');
    const lines = order.lines || [];
    const g = lines.find(l => l.sku === 'GLV-NIT-M'); ok(g, 'order has no GLV-NIT-M line');
    eq(g.qty, 5, 'quantity'); eq(g.price, 26, 'unit price on the order');
    eq(order.total, 130, 'order total (excl. VAT)'); eq(r2(order.total * 0.15), 19.5, 'VAT 15% of the order'); eq(r2(order.total * 1.15), 149.5, 'order incl. VAT');
    ok(order.name && (order.email || order.phone), 'customer details missing on the order');
    ok(order.status === 'new', 'a fresh order should be "new", it is ' + order.status);
    refused(await c.put(`/api/website/submissions/${order.id}`, { status: 'processed' }), 'unknown status', [400]);
    must(await c.put(`/api/website/submissions/${order.id}`, { status: 'done' }), 'set status done');
    const again = must(await c.get(`/api/website/submissions?siteId=${site.id}&kind=order`), 'orders again').find(x => x.id === order.id);
    ok(again.status === 'done', 'status change was not saved: ' + again.status);
    // Reem cannot publish a site (web.publish is Khalid's)
    refused(await c.post(`/api/website/sites/${site.id}/publish`, { html: '<p>x</p>', products: [] }), 'publish by Reem');
    ctx.S.webOrder = { number: order.number, id: order.id, total: 130, status: 'done' };
    return `order ${order.number} ${posted ? '(posted by Reem)' : '(already posted by the site owner)'}: 5 x 26.00 = 130.00 (+19.50 VAT = 149.50), status done`;
  });
}

// ================================================================== DAY 4
async function day4(ctx) {
  const c = reem(ctx);
  const S = mine(ctx);

  manual('U4-17-UI', 'Assistant, network off: "create module Visitors", "add field Badge number", "make Badge number required"', 'The typed assistant commands and the offline behaviour run in the browser. The same three changes are checked by U4-17 through the module API the assistant calls.');

  await step('U4-17', 'Custom module Visitors (template fields) + field Badge number, required (same calls as the assistant)', async () => {
    // the assistant's "visitors" template
    const fields = [
      { key: '', label: 'Visitor name', labelAr: 'اسم الزائر', type: 'text', required: true },
      { key: '', label: 'Company', labelAr: 'الشركة', type: 'text', required: false },
      { key: '', label: 'Phone', labelAr: 'الجوال', type: 'phone', required: false },
      { key: '', label: 'Host', labelAr: 'المضيف', type: 'text', required: false },
      { key: '', label: 'Visit date', labelAr: 'تاريخ الزيارة', type: 'date', required: false },
      { key: '', label: 'Purpose', labelAr: 'الغرض', type: 'textarea', required: false },
      { key: '', label: 'Status', labelAr: 'الحالة', type: 'select', required: false, options: ['Expected', 'In', 'Out'] },
    ];
    const def = { title: 'Visitors', icon: 'users', color: '#0ea5e9', fields };
    let r = await c.post('/api/custom/modules', def);
    let note = '';
    if (!r.ok && (r.status === 403 || r.status === 401)) {
      // Reem has cus.view + cus.manage only; creating or changing a module needs cus.design (see Needed changes)
      const k = await ctx.U.khalid.post('/api/custom/modules', def);
      must(k, 'create module as Khalid (fallback)');
      S.module = k.data; S.fallback = true;
      // keep going so U4-18 can run: add the field as Khalid too
      const withBadge = { ...k.data.def, fields: [...k.data.def.fields, { key: '', label: 'Badge number', type: 'text', required: true }] };
      must(await ctx.U.khalid.put(`/api/custom/modules/${k.data.key}`, withBadge), 'add Badge number as Khalid (fallback)');
      throw new Error(`Reem is refused (HTTP ${r.status}): creating a custom module needs privilege cus.design, which Reem does not have (see "Needed changes"). Module "${k.data.key}" was created by Khalid so U4-18 can still run.`);
    }
    must(r, 'create module Visitors'); S.module = r.data;
    const key = S.module.key; ok(key === 'visitors' || /^visitors/.test(key), 'module key is ' + key);
    const names = S.module.def.fields.map(f => f.label);
    ok(['Visitor name', 'Company', 'Phone', 'Host', 'Visit date', 'Purpose', 'Status'].every(n => names.includes(n)), 'template fields missing: ' + names.join(', '));
    // add field Badge number (optional), then make it required
    let d1 = { ...S.module.def, fields: [...S.module.def.fields, { key: '', label: 'Badge number', type: 'text', required: false }] };
    let u = must(await c.put(`/api/custom/modules/${key}`, d1), 'add field Badge number');
    const badge = u.def.fields.find(f => f.label === 'Badge number'); ok(badge, 'Badge number was not added');
    ok(!badge.required, 'Badge number should start optional');
    const d2 = { ...u.def, fields: u.def.fields.map(f => f.key === badge.key ? { ...f, required: true } : f) };
    u = must(await c.put(`/api/custom/modules/${key}`, d2), 'make Badge number required');
    ok(u.def.fields.find(f => f.label === 'Badge number').required === true, 'Badge number is not required after the change');
    const listed = must(await c.get('/api/custom/modules'), 'module list').find(m => m.key === key); ok(listed, 'module not in the list (sidebar)');
    S.module = { key, def: u.def }; ctx.S.visitorsModule = { key, badgeKey: badge.key };
    return `module "${key}" with ${u.def.fields.length} fields; Badge number (${badge.key}) required`;
  });

  await step('U4-18', 'Visitors: save without badge is refused naming Badge number; with 118 it saves and is listed', async () => {
    dep(S.module && S.module.key, 'U4-17');
    const key = S.module.key;
    const def = (must(await c.get('/api/custom/modules'), 'modules').find(m => m.key === key) || {}).def; ok(def, 'module definition not readable');
    const f = lab => { const x = def.fields.find(y => y.label === lab); ok(x, 'field ' + lab + ' missing'); return x.key; };
    const row = { [f('Visitor name')]: 'Dr. Majed Al-Sabti', [f('Company')]: 'Al-Hayat Clinics', [f('Host')]: 'Reem', [f('Visit date')]: '2026-10-14', [f('Purpose')]: 'Contract review' };
    const bad = refused(await c.post(`/api/custom/records/${key}`, { data: row }), 'save without badge number', [400]);
    ok(/badge number/i.test(bad.text), 'the refusal does not name Badge number: ' + bad.text);
    const good = must(await c.post(`/api/custom/records/${key}`, { data: { ...row, [f('Badge number')]: '118' } }), 'save with badge number');
    ok(good.code, 'record has no code'); ok(String(good.data[f('Badge number')]) === '118', 'badge number not stored');
    const list = must(await c.get(`/api/custom/records/${key}`), 'list');
    ok(list.some(r => r.id === good.id), 'saved visitor is not in the list');
    ok(!list.some(r => !r.data[f('Badge number')]), 'a row without badge number was stored');
    ctx.S.visitor = { module: key, id: good.id, code: good.code, badge: '118', name: 'Dr. Majed Al-Sabti' };
    // the designer and viewer sides
    const kh = await ctx.U.khalid.get(`/api/custom/records/${key}`);
    return `refused: ${bad.text.slice(0, 80)}; saved ${good.code}` + (kh.ok ? `; visible to Khalid (${kh.data.length} row)` : '');
  });

  await step('U4-19', 'Calendar: 30-minute Jitsi meeting with external guest at 2026-10-14 14:00 Riyadh; .ics correct', async () => {
    const m = must(await c.post('/api/calendar/events', { kind: 'meeting', title: 'Contract review with Dr. Majed Al-Sabti', start: '2026-10-14T11:00:00Z', end: '2026-10-14T11:30:00Z',
      guests: [MAJED_EMAIL], notes: 'Contract review - Al-Hayat Clinics', remindMinutes: 15 }), 'create meeting');
    const ev = m.ev; ok(ev && ev.id, 'no event returned');
    ok(ev.kind === 'meeting', 'kind ' + ev.kind); ok(ev.room && /^we-/.test(ev.room), 'no meeting room generated: ' + ev.room);
    ok(Array.isArray(ev.data.guests) && ev.data.guests.includes(MAJED_EMAIL), 'external guest not stored');
    eq((new Date(ev.end) - new Date(ev.start)) / 60000, 30, 'meeting length in minutes');
    const j = must(await c.post(`/api/calendar/events/${ev.id}/join`, {}), 'join link');
    ok(/^https:\/\/[^/]+\/we-/.test(j.url), 'join url looks wrong: ' + j.url);
    const settings = must(await c.get('/api/calendar/settings'), 'calendar settings'); ok(j.url.includes(settings.jitsiDomain), 'meeting link does not use the Jitsi server of the settings');
    const ics = await c.get(`/api/calendar/events/${ev.id}/ics`);
    ok(ics.ok && typeof ics.data === 'string', 'ics download failed: HTTP ' + ics.status);
    const t = ics.data;
    ok(t.startsWith('BEGIN:VCALENDAR'), 'not a calendar file');
    ok(/DTSTART:20261014T110000Z/.test(t), 'DTSTART is not 11:00 UTC (= 14:00 Riyadh): ' + (t.match(/DTSTART:[^\r\n]*/) || [''])[0]);
    ok(/DTEND:20261014T113000Z/.test(t), 'DTEND is not 11:30 UTC');
    ok(t.includes('SUMMARY:Contract review with Dr. Majed Al-Sabti'), 'SUMMARY missing'); ok(t.includes(j.url), 'meeting link missing in the .ics');
    ctx.S.meeting = { id: ev.id, room: ev.room, url: j.url, start: ev.start, guest: MAJED_EMAIL };
    return `meeting ${ev.room}, link ${j.url}, .ics DTSTART 20261014T110000Z (14:00 Riyadh); invitation e-mails sent: ${m.emailed}${m.emailed ? '' : ' (mail server not configured)'}`;
  });
}

module.exports = { day0, day1, day2, day3, day4 };
