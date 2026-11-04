// User 3 - Faisal Al-Ghamdi, Supply Chain and Plant Manager (procurement, warehouse, supply chain, manufacturing, items, calendar, workflow requester).
// Steps U3-01 .. U3-17 of the UAT scenario document. Real API behaviour wins over the document; deviations are listed in u3.notes.md.
//
// Stock model of the backend: stock is kept per BRANCH code (stock record code "JED|SM-3PLY"), not per warehouse/bin. The document's
// JED-MAIN / DMM-STORE / RYD-HOSP stock locations therefore map to the branch codes ctx.branch.JED / DMM / RYD. Warehouse and bin
// records (wh/location) are descriptive master data only.
//
// Shared with other users through ctx.S:
//   ctx.S.items          codes of the eight items
//   ctx.S.rq             { id, code }                         the approved requisition (becomes the Gulf order)
//   ctx.S.pos            { gulf:{id,code,total}, eastern:{...}, packaging:{...} }   draft POs; Noura (proc.po.approve) approves, later invoices
//   ctx.S.wo             { id, code }                         the gown work order
//   ctx.S.u3             misc ids (picks, transfers, shipment, count ...)
const { must, refused, eq, ok, step, manual, addDays } = require('./lib');

const ITEMS = [
  // code, name, unit, type, cost, wholesale, retail
  ['SM-3PLY',   'Surgical mask 3-ply, box of 50', 'box',  'Trade',         8.00, 12.00, 15.00],
  ['GLV-NIT-M', 'Nitrile gloves M, box of 100',   'box',  'Trade',        14.00, 20.00, 26.00],
  ['SYR-5ML',   'Syringe 5 ml, box of 100',       'box',  'Trade',        18.00, 27.00, 34.00],
  ['THERM-DIG', 'Digital thermometer',            'pcs',  'Trade',        11.00, 18.00, 25.00],
  ['GOWN-10',   'Isolation gown, pack of 10',     'pack', 'Finished good',50.00, 75.00, 90.00],
  ['NW-ROLL',   'Non-woven fabric',               'm',    'Raw material',  2.50, null, null],
  ['ELS-CUFF',  'Elastic cuff',                   'pcs',  'Raw material',  0.15, null, null],
  ['PK-BAG',    'Polybag',                        'pcs',  'Raw material',  0.80, null, null],
];
const VENDOR = { gulf: 'Gulf Medical Imports LLC', eastern: 'Eastern Textile Co.', packaging: 'Riyadh Packaging Est.', redsea: 'Red Sea Medical' };
const WC = 'WC-SEW';

// ------------------------------------------------------------------ helpers
const F = ctx => { ok(ctx.U && ctx.U.faisal, 'Faisal is not logged in (bootstrap failed)'); return ctx.U.faisal; };
const me = ctx => ctx.users.faisal;
const S3 = ctx => (ctx.S.u3 = ctx.S.u3 || {});
const API = (m, p) => `/api/erp/${m}/${p}`;
const recPath = (m, k) => API(m, `records/${k}`);
const clone = o => JSON.parse(JSON.stringify(o));

/** Create an ERP record as Faisal. */
async function create(ctx, module, kind, body, what) {
  const b = Object.assign({ company: ctx.company }, body);
  return must(await F(ctx).post(recPath(module, kind), b), what || `create ${module}/${kind}`);
}
async function update(ctx, module, kind, id, body, what) {
  return must(await F(ctx).put(recPath(module, kind) + '/' + id, body), what || `update ${module}/${kind}`);
}
async function list(ctx, module, kind, qs = '') {
  return must(await F(ctx).get(recPath(module, kind) + '?take=5000' + qs), `list ${module}/${kind}`);
}
async function getRec(ctx, module, kind, id) {
  const l = await list(ctx, module, kind);
  const r = l.find(x => x.id === id);
  ok(r, `${module}/${kind} ${id} not found`);
  return r;
}
async function action(ctx, path, body) { return must(await F(ctx).post(path, body === undefined ? {} : body), path); }

/** Stock per sku for a branch, from the warehouse stock endpoint (what the Warehouse > Stock screen shows). */
async function stockOf(ctx, branch) {
  const rows = must(await F(ctx).get(API('wh', 'wh-stock') + '?branch=' + encodeURIComponent(branch)), 'wh-stock ' + branch);
  const m = {}; for (const r of rows) m[r.sku] = (m[r.sku] || 0) + Number(r.qty); return { map: m, rows };
}
function expectStock(map, exp, label) {
  const bad = [];
  for (const [k, v] of Object.entries(exp)) { const got = map[k] === undefined ? 0 : map[k]; if (Math.abs(got - v) > 0.005) bad.push(`${k} expected ${v} got ${got}`); }
  if (bad.length) throw new Error(`${label}: ${bad.join('; ')}`);
}
/** Vendor code: from U2's master data, else looked up by name in Finance vendors; never created here. */
async function vendorCode(ctx, name, optional) {
  const v = ctx.S.vendors || {};
  if (v[name]) return v[name];
  const r = await F(ctx).get(API('proc', 'lookups/vendors'));
  if (r.ok) { const f = (r.data || []).find(x => String(x.name).toLowerCase() === name.toLowerCase()); if (f) return f.code; }
  if (optional) return name;
  throw new Error(`vendor "${name}" not found: ctx.S.vendors (U2 preDay0) lacks it and no Finance vendor of that name exists`);
}
/** POS endpoints (items, transfers) need pos.* privileges that Faisal has not been given in u0.js: try him first, fall back to Khalid (admin). */
async function posCall(ctx, method, path, body) {
  let r = await F(ctx).call(method, path, body);
  if (r.status === 403 && ctx.U.khalid) {
    ctx.S.u3 = ctx.S.u3 || {}; ctx.S.u3.usedAdminForPos = true;
    r = await ctx.U.khalid.call(method, path, body); r.viaAdmin = true;
  }
  return r;
}
const poRef = (ctx, key, step_) => {
  const p = ctx.S.pos && ctx.S.pos[key];
  if (!p || !p.id) throw new Error(`depends on ${step_}: ctx.S.pos.${key} missing`);
  return p;
};
/** Run several independent sub-checks; fail at the end listing every problem. */
async function each(items, fn) {
  const errs = [], notes = [];
  for (const it of items) { try { const n = await fn(it); if (n) notes.push(n); } catch (e) { errs.push(String(e.message || e)); } }
  if (errs.length) throw new Error(errs.join(' | '));
  return notes.join('; ');
}
const poStatus = async (ctx, p) => (await getRec(ctx, 'proc', 'po', p.id));

// ------------------------------------------------------------------ Day 0
exports.day0 = async function (ctx) {
  await step('U3-01', 'Warehouses JED-MAIN (bins A-01..A-04), DMM-STORE, RYD-HOSP and the eight items', async () => {
    const out = [];
    // --- locations (descriptive master data)
    const locs = [
      ['JED-MAIN', 'Jeddah main warehouse', 'Warehouse', null, ctx.branch.JED],
      ['A-01', 'Bin A-01', 'Bin', 'JED-MAIN', ctx.branch.JED], ['A-02', 'Bin A-02', 'Bin', 'JED-MAIN', ctx.branch.JED],
      ['A-03', 'Bin A-03', 'Bin', 'JED-MAIN', ctx.branch.JED], ['A-04', 'Bin A-04', 'Bin', 'JED-MAIN', ctx.branch.JED],
      ['DMM-STORE', 'Dammam retail store', 'Warehouse', null, ctx.branch.DMM],
      ['RYD-HOSP', 'Riyadh hospital store', 'Warehouse', null, ctx.branch.RYD],
    ];
    for (const [code, name, type, parent, branch] of locs)
      await create(ctx, 'wh', 'location', { code, branch, data: { name, type, parent: parent || '' } }, 'location ' + code);
    const got = await list(ctx, 'wh', 'location');
    for (const [code] of locs) ok(got.some(x => x.code === code), `location ${code} not listed`);
    out.push(`${locs.length} locations`);

    // --- items = POS products
    let viaAdmin = false;
    for (const [code, name, unit, type, cost, wholesale, retail] of ITEMS) {
      const data = { name, unit, type, cost, price: retail === null ? 0 : retail, trackStock: true, reorder: code === 'SM-3PLY' ? 1000 : 0, taxRate: '' };
      if (wholesale !== null) data.wholesalePrice = wholesale;
      const r = await posCall(ctx, 'POST', '/api/pos/records/product', { code, company: ctx.company, status: 'Active', data });
      must(r, 'item ' + code); if (r.viaAdmin) viaAdmin = true;
    }
    ctx.S.items = ITEMS.map(i => i[0]);
    // visible to Faisal through the Manufacturing item lookup, cost as entered
    const items = must(await F(ctx).get(API('mfg', 'items')), 'mfg items');
    for (const [code, , , , cost] of ITEMS) {
      const it = items.find(x => x.sku === code); ok(it, `item ${code} not visible to Faisal`); eq(it.cost, cost, `${code} cost`);
    }
    // zero stock everywhere: stock rows are created on the first movement, so none (or only zero rows) must exist
    for (const b of [ctx.branch.JED, ctx.branch.DMM, ctx.branch.RYD]) {
      const { map } = await stockOf(ctx, b);
      for (const c of ctx.S.items) eq(map[c] || 0, 0, `${b} ${c} stock`);
    }
    out.push('8 items, zero stock in JED/DMM/RYD' + (viaAdmin ? ' (items created by Khalid: Faisal lacks pos.products.manage)' : ''));
    return out.join('; ');
  });
};

// ------------------------------------------------------------------ Day 1
exports.day1 = async function (ctx) {
  const s3 = S3(ctx);
  const reqLines = [
    { sku: 'SM-3PLY', desc: 'Surgical mask 3-ply, box of 50', qty: 2000, price: 8 },
    { sku: 'GLV-NIT-M', desc: 'Nitrile gloves M, box of 100', qty: 1000, price: 14 },
    { sku: 'SYR-5ML', desc: 'Syringe 5 ml, box of 100', qty: 500, price: 18 },
    { sku: 'THERM-DIG', desc: 'Digital thermometer', qty: 200, price: 11 },
  ];

  await step('U3-02', 'Requisition SM 2,000 / GLV 1,000 / SYR 500 / THERM 200, self-approved', async () => {
    const data = { department: 'Procurement', needBy: addDays(ctx.today, 5), requester: me(ctx), reason: 'Q4 trade stock for Jeddah warehouse', lines: reqLines };
    const rq = await create(ctx, 'proc', 'requisition', { branch: ctx.branch.JED, data }, 'create requisition');
    ok(rq.code && /^PR-/.test(rq.code), 'requisition code not auto-numbered: ' + rq.code);
    eq(rq.status === 'Draft' ? 1 : 0, 1, 'new requisition status is Draft');
    ctx.S.rq = { id: rq.id, code: rq.code };
    await update(ctx, 'proc', 'requisition', rq.id, { status: 'Submitted', data }, 'submit requisition');
    const ap = await update(ctx, 'proc', 'requisition', rq.id, { status: 'Approved', data: Object.assign({}, data, { approvedBy: me(ctx) }) }, 'approve requisition');
    eq(ap.status === 'Approved' ? 1 : 0, 1, 'requisition status Approved (got ' + ap.status + ')');
    const re = await getRec(ctx, 'proc', 'requisition', rq.id);
    eq(re.data.lines.length, 4, 'requisition lines');
    return `${rq.code} Approved, ready for conversion`;
  });

  await step('U3-03', 'RFQ (Gulf 8.00 vs Red Sea 8.40), evaluations 60/40 rank Gulf first, 12-month contract 200,000', async () => {
    const gulf = await vendorCode(ctx, VENDOR.gulf);
    const red = await vendorCode(ctx, VENDOR.redsea, true);
    const rfqData = {
      title: 'SM-3PLY 2,000 boxes', due: addDays(ctx.today, 3),
      lines: [{ sku: 'SM-3PLY', qty: 2000, target: 8 }],
      quotes: [{ vendor: gulf, amount: 16000, leadDays: 5, note: '8.00 per box' }, { vendor: red, amount: 16800, leadDays: 9, note: '8.40 per box' }],
    };
    const rfq = await create(ctx, 'proc', 'rfq', { branch: ctx.branch.JED, data: rfqData }, 'create rfq');
    await update(ctx, 'proc', 'rfq', rfq.id, { status: 'Sent', data: rfqData }, 'send rfq');
    const aw = await update(ctx, 'proc', 'rfq', rfq.id, { status: 'Awarded', data: Object.assign({}, rfqData, { awarded: gulf }) }, 'award rfq');
    eq(aw.status === 'Awarded' ? 1 : 0, 1, 'RFQ status Awarded');
    // evaluations: price score = cheapest/own, delivery score = fastest/own; weights 60/40
    const q = rfqData.quotes, minAmt = Math.min(...q.map(x => x.amount)), minLead = Math.min(...q.map(x => x.leadDays));
    for (const x of q) {
      const price = Math.round(minAmt / x.amount * 10000) / 100, delivery = Math.round(minLead / x.leadDays * 10000) / 100;
      const weighted = Math.round((price * 0.6 + delivery * 0.4) * 100) / 100;
      await create(ctx, 'proc', 'evaluation', { data: { vendor: x.vendor, period: ctx.today.slice(0, 7), quality: 80, service: 80, price, delivery, weightPrice: 60, weightDelivery: 40, weighted, rfq: rfq.code } }, 'evaluation');
    }
    const evs = (await list(ctx, 'proc', 'evaluation')).filter(e => e.data.rfq === rfq.code).sort((a, b) => Number(b.data.weighted) - Number(a.data.weighted));
    eq(evs.length, 2, 'evaluations for this RFQ');
    eq(evs[0].data.vendor === gulf ? 1 : 0, 1, 'evaluation ranks Gulf first (top vendor ' + evs[0].data.vendor + ')');
    // contract
    const con = await create(ctx, 'proc', 'contract', { data: { title: '12-month framework agreement', vendor: gulf, start: ctx.today, end: addDays(ctx.today, 365), value: 200000, terms: 'Framework, SM-3PLY at 8.00 per box' } }, 'create contract');
    eq(con.status === 'Active' ? 1 : 0, 1, 'contract Active (got ' + con.status + ')');
    eq(con.data.value, 200000, 'contract ceiling');
    s3.rfq = rfq.code; s3.contract = con.code;
    return `${rfq.code} awarded, Gulf scores ${evs[0].data.weighted} vs ${evs[1].data.weighted}; contract ${con.code} Active 200,000`;
  });

  await step('U3-04', 'Purchase order to Gulf from the requisition: 41,200 + VAT 6,180 = 47,380', async () => {
    if (!ctx.S.rq) throw new Error('depends on U3-02: ctx.S.rq missing');
    const gulf = await vendorCode(ctx, VENDOR.gulf);
    const po = must(await F(ctx).post(API('proc', `requisitions/${ctx.S.rq.id}/topo`), { vendor: gulf }), 'requisition to PO');
    ctx.S.pos = ctx.S.pos || {};
    ctx.S.pos.gulf = { id: po.id, code: po.code, total: po.data.total };
    eq(po.status === 'Draft' ? 1 : 0, 1, 'PO starts as Draft (got ' + po.status + ')');
    eq(po.data.amount, 41200, 'PO subtotal'); eq(po.data.taxAmount, 6180, 'PO VAT'); eq(po.data.total, 47380, 'PO total');
    eq(po.data.lines.length, 4, 'PO lines');
    const rq = await getRec(ctx, 'proc', 'requisition', ctx.S.rq.id);
    eq(rq.status === 'Ordered' ? 1 : 0, 1, 'requisition is Ordered after conversion (got ' + rq.status + ')');
    // a second conversion of the same requisition must be refused
    refused(await F(ctx).post(API('proc', `requisitions/${ctx.S.rq.id}/topo`), { vendor: gulf }), 'second conversion');
    // Faisal cannot approve his own order (no proc.po.selfApprove)
    refused(await F(ctx).post(API('proc', `pos/${po.id}/approve`)), 'self approval');
    return `${po.code} Draft total 47,380; awaiting Noura (separate approver, not a workflow)`;
  });

  await step('U3-05', 'Orders to Eastern Textile (8,625) and Riyadh Packaging (1,230.50)', async () => {
    const east = await vendorCode(ctx, VENDOR.eastern), pack = await vendorCode(ctx, VENDOR.packaging);
    ctx.S.pos = ctx.S.pos || {};
    const mk = async (vendor, lines) => create(ctx, 'proc', 'po', {
      branch: ctx.branch.JED,
      data: { vendor, date: ctx.today, expected: addDays(ctx.today, 5), taxPct: 15, notes: 'Within Q4 budget', lines: lines.map(l => Object.assign({ discountPct: 0, received: 0 }, l)) },
    }, 'create PO');
    const e = await mk(east, [{ sku: 'NW-ROLL', desc: 'Non-woven fabric', qty: 3000, price: 2.5 }]);
    ctx.S.pos.eastern = { id: e.id, code: e.code, total: e.data.total };
    eq(e.data.amount, 7500, 'Eastern subtotal'); eq(e.data.taxAmount, 1125, 'Eastern VAT'); eq(e.data.total, 8625, 'Eastern total');
    const p = await mk(pack, [{ sku: 'ELS-CUFF', desc: 'Elastic cuff', qty: 5000, price: 0.15 }, { sku: 'PK-BAG', desc: 'Polybag', qty: 400, price: 0.8 }]);
    ctx.S.pos.packaging = { id: p.id, code: p.code, total: p.data.total };
    eq(p.data.amount, 1070, 'Packaging subtotal'); eq(p.data.taxAmount, 160.5, 'Packaging VAT'); eq(p.data.total, 1230.5, 'Packaging total');
    eq(e.status === 'Draft' && p.status === 'Draft' ? 1 : 0, 1, 'both orders are Draft (no auto-approval under 5,000 in the real system)');
    return `${e.code} 8,625.00 and ${p.code} 1,230.50, both Draft until Noura approves`;
  });
};

// ------------------------------------------------------------------ Day 2
exports.day2 = async function (ctx) {
  const s3 = S3(ctx), JED = ctx.branch.JED;

  await step('U3-06', 'Receive the three orders (Gulf THERM 150 of 200); stock in JED', async () => {
    const keys = ['gulf', 'eastern', 'packaging'];
    const note = await each(keys, async k => {
      const p = poRef(ctx, k, 'U3-04/05');
      let r = await poStatus(ctx, p);
      if (r.status === 'Draft') throw new Error(`${p.code} is still Draft: Noura (U2, proc.po.approve) must approve it on day 1 before it can be received`);
      if (r.status === 'Approved') r = must(await F(ctx).post(API('proc', `pos/${p.id}/send`)), 'send PO');
      eq(r.status === 'Sent' ? 1 : 0, 1, `${p.code} Sent (got ${r.status})`);
      const body = k === 'gulf'
        ? { lines: [{ sku: 'SM-3PLY', qty: 2000 }, { sku: 'GLV-NIT-M', qty: 1000 }, { sku: 'SYR-5ML', qty: 500 }, { sku: 'THERM-DIG', qty: 150 }], note: 'Partial: thermometers 150 of 200' }
        : { note: 'Full receipt' };
      const res = must(await F(ctx).post(API('proc', `pos/${p.id}/receive`), body), 'receive ' + p.code);
      if (k === 'gulf') {
        eq(res.status === 'PartiallyReceived' ? 1 : 0, 1, 'Gulf order PartiallyReceived (got ' + res.status + ')');
        const th = res.data.lines.find(l => l.sku === 'THERM-DIG'); eq(th.received, 150, 'THERM received'); eq(Number(th.qty) - Number(th.received), 50, 'THERM still open');
      } else eq(res.status === 'Received' ? 1 : 0, 1, `${p.code} Received (got ${res.status})`);
      return `${p.code} ${res.status}`;
    });
    const { map } = await stockOf(ctx, JED);
    expectStock(map, { 'SM-3PLY': 2000, 'GLV-NIT-M': 1000, 'SYR-5ML': 500, 'THERM-DIG': 150, 'NW-ROLL': 3000, 'ELS-CUFF': 5000, 'PK-BAG': 400 }, 'JED stock after receipts');
    return note + '; JED stock matches';
  });

  await step('U3-07', 'BOM GOWN-10 (15 NW-ROLL + 20 ELS-CUFF + 1 PK-BAG, standard 50.00) and MRP for 100 packs', async () => {
    // work centre and costing defaults chosen so that the document's figures come out exactly (see notes)
    const wcs = await list(ctx, 'mfg', 'workcenter');
    if (!wcs.some(w => w.code === WC)) await create(ctx, 'mfg', 'workcenter', { code: WC, branch: JED, data: { name: 'Gown sewing line', costPerHour: 120, capacityHours: 8 } }, 'work centre');
    const sets = await list(ctx, 'mfg', 'setting');
    const def = sets.find(s => s.code === 'defaults'); const sd = Object.assign({}, def ? def.data : {}, { overheadPct: 25, allowNegativeStock: false });
    if (def) await update(ctx, 'mfg', 'setting', def.id, { data: sd }, 'mfg defaults'); else await create(ctx, 'mfg', 'setting', { code: 'defaults', data: sd }, 'mfg defaults');
    const bomData = { name: 'Isolation gown, pack of 10', qty: 1, workCenter: WC, routingMinutes: 3.48,
      lines: [{ sku: 'NW-ROLL', qty: 15, scrapPct: 0 }, { sku: 'ELS-CUFF', qty: 20, scrapPct: 0 }, { sku: 'PK-BAG', qty: 1, scrapPct: 0 }] };
    const bom = await create(ctx, 'mfg', 'bom', { code: 'GOWN-10', branch: JED, data: bomData }, 'create BOM');
    s3.bom = { id: bom.id };
    // standard cost like the Costing screen: components at item cost + routing time at the work-centre rate + overhead
    const items = must(await F(ctx).get(API('mfg', 'items')), 'items'); const cost = c => items.find(i => i.sku === c).cost;
    const material = bomData.lines.reduce((s, l) => s + l.qty * cost(l.sku), 0);
    const labor = Math.round(bomData.routingMinutes / 60 * 120 * 100) / 100, overhead = Math.round(labor * 25) / 100;
    eq(material, 41.3, 'BOM material cost'); eq(Math.round((material + labor + overhead) * 100) / 100, 50, 'BOM standard cost');
    // MRP (the Planning screen calculates it in the browser from BOM + stock): need for 100 packs against JED stock
    const stock = must(await F(ctx).get(API('mfg', 'stock') + '?branch=' + JED), 'mfg stock'); const have = c => Number((stock.find(s => s.sku === c) || {}).qty || 0);
    const need = { 'NW-ROLL': 1500, 'ELS-CUFF': 2000, 'PK-BAG': 100 };
    for (const l of bomData.lines) eq(l.qty * 100, need[l.sku], 'need ' + l.sku);
    const short = Object.entries(need).filter(([c, n]) => have(c) < n);
    ok(short.length === 0, 'MRP would suggest purchases for: ' + short.map(([c, n]) => `${c} need ${n} have ${have(c)}`).join(', '));
    return 'BOM GOWN-10 saved, standard 50.00; need 1,500 m / 2,000 cuffs / 100 bags all covered by JED stock, no purchase suggestion';
  });

  await step('U3-08', 'Work order 100 GOWN-10: release, start, complete 98 good + 2 scrap; quality inspection', async () => {
    const bomRec = await getRec(ctx, 'mfg', 'bom', (s3.bom || {}).id || (() => { throw new Error('depends on U3-07: BOM missing'); })());
    const wo = await create(ctx, 'mfg', 'workorder', { branch: JED, data: { sku: 'GOWN-10', qty: 100, due: addDays(ctx.today, 3), priority: 'Normal', workCenter: WC,
      lines: clone(bomRec.data.lines), bomQty: bomRec.data.qty, routingMinutes: bomRec.data.routingMinutes } }, 'create work order');
    ctx.S.wo = { id: wo.id, code: wo.code }; s3.wo = ctx.S.wo;
    eq(wo.status === 'Planned' ? 1 : 0, 1, 'work order starts Planned');
    let r = await action(ctx, API('mfg', `workorders/${wo.id}/release`)); eq(r.status === 'Released' ? 1 : 0, 1, 'Released (got ' + r.status + ')');
    r = await action(ctx, API('mfg', `workorders/${wo.id}/start`)); eq(r.status === 'InProgress' ? 1 : 0, 1, 'InProgress (got ' + r.status + ')');
    // 100 packs are made; 2 are rejected for stitching -> 98 good receipts, 2 scrap. Materials are issued for all 100.
    r = await action(ctx, API('mfg', `workorders/${wo.id}/complete`), { qty: 98, scrap: 2, hours: 5.8, note: '2 rejected for stitching' });
    eq(r.status === 'Completed' ? 1 : 0, 1, 'Completed (got ' + r.status + ')');
    eq(r.data.goodQty, 98, 'good qty'); eq(r.data.scrapQty, 2, 'scrap qty');
    const { map } = await stockOf(ctx, JED);
    expectStock(map, { 'NW-ROLL': 1500, 'ELS-CUFF': 3000, 'PK-BAG': 300, 'GOWN-10': 98 }, 'JED stock after production');
    // quality inspection record for the order: 100 inspected, 2 defects, accepted 98
    const qc = await create(ctx, 'mfg', 'inspection', { branch: JED, ref: wo.code, status: 'Passed', data: { type: 'Final', sku: 'GOWN-10', qty: 100, sample: 100, defects: 2, inspector: me(ctx), date: ctx.today, notes: 'Rejected 2 for stitching, accepted 98' } }, 'inspection');
    eq(qc.data.defects, 2, 'inspection defects');
    return `${wo.code} Completed; NW-ROLL 1,500, ELS-CUFF 3,000, PK-BAG 300, GOWN-10 98, scrap 2; inspection ${qc.code}`;
  });

  await step('U3-09', 'Costing of the work order: 5,000.00 = 4,130 materials + 870 labour/overhead; 51.02 per good pack', async () => {
    if (!ctx.S.wo) throw new Error('depends on U3-08: ctx.S.wo missing');
    const w = await getRec(ctx, 'mfg', 'workorder', ctx.S.wo.id), d = w.data;
    eq(w.status === 'Completed' ? 1 : 0, 1, 'work order Completed');
    eq(d.materialCost, 4130, 'material cost'); eq(Number(d.laborCost) + Number(d.overheadCost), 870, 'labour + overhead');
    eq(d.actualCost, 5000, 'order cost'); eq(d.unitCost, 51.02, 'cost per good pack');
    // the document's "variance 100.00" = (51.02 - 50.00) x 98 good packs; the system compares total cost with the standard of all 100 produced
    const perPackVar = Math.round((Number(d.unitCost) - 50) * Number(d.goodQty) * 100) / 100;
    ok(Math.abs(perPackVar - 100) <= 0.1, 'unit-cost variance x good packs should be about 100.00, got ' + perPackVar);
    eq(d.standardCost, 5000, 'system standard cost for 100 produced'); eq(d.variance, 0, 'system variance (actual 5,000 vs standard 5,000)');
    const items = must(await F(ctx).get(API('mfg', 'items')), 'items');
    eq(items.find(i => i.sku === 'GOWN-10').cost, 51.02, 'GOWN-10 item cost after moving average');
    return `actual ${d.actualCost}, unit ${d.unitCost}; per-pack variance x98 = ${perPackVar}; system variance ${d.variance}`;
  });

  await step('U3-10', 'Transfer JED to DMM: SM 40, GLV 20, SYR 10, THERM 10', async () => {
    const lines = [{ sku: 'SM-3PLY', qty: 40 }, { sku: 'GLV-NIT-M', qty: 20 }, { sku: 'SYR-5ML', qty: 10 }, { sku: 'THERM-DIG', qty: 10 }];
    const t = must(await posCall(ctx, 'POST', '/api/pos/transfers', { company: ctx.company, fromBranch: JED, toBranch: ctx.branch.DMM, lines, note: 'Shop replenishment' }), 'create transfer');
    eq(t.status === 'InTransit' ? 1 : 0, 1, 'transfer InTransit');
    s3.trfDmm = { id: t.id, code: t.code };
    let { map } = await stockOf(ctx, JED);
    expectStock(map, { 'SM-3PLY': 1960, 'GLV-NIT-M': 980, 'SYR-5ML': 490, 'THERM-DIG': 140 }, 'JED after dispatch');
    const rc = must(await posCall(ctx, 'POST', `/api/pos/transfers/${t.id}/receive`), 'receive transfer');
    eq(rc.status === 'Received' ? 1 : 0, 1, 'transfer Received');
    ({ map } = await stockOf(ctx, ctx.branch.DMM));
    expectStock(map, { 'SM-3PLY': 40, 'GLV-NIT-M': 20, 'SYR-5ML': 10, 'THERM-DIG': 10 }, 'DMM after receipt');
    return `${t.code}: JED 1,960/980/490/140; DMM 40/20/10/10`;
  });
};

// ------------------------------------------------------------------ Day 3
exports.day3 = async function (ctx) {
  const s3 = S3(ctx), JED = ctx.branch.JED;
  const soRef = k => { const so = ctx.S.salesOrders || ctx.S.so || {}; const x = so[k]; return (x && (x.code || x.docNumber || x.id)) || ''; };

  await step('U3-11', 'Picks for Reem: Al-Hayat (SM 500, GLV 300, GOWN-10 40) and Najd (SYR 400, THERM 100), confirmed', async () => {
    const mk = async (ref, lines) => {
      const pk = await create(ctx, 'wh', 'pick', { branch: JED, data: { reference: ref, due: ctx.today, picker: me(ctx), lines: lines.map(l => Object.assign({ location: 'A-01' }, l)) } }, 'create pick');
      eq(pk.status === 'Open' ? 1 : 0, 1, 'pick starts Open');
      return pk;
    };
    const a = await mk(soRef('alHayat') || soRef('alhayat') || 'SO Al-Hayat Clinics', [{ sku: 'SM-3PLY', qty: 500 }, { sku: 'GLV-NIT-M', qty: 300 }, { sku: 'GOWN-10', qty: 40 }]);
    const n = await mk(soRef('najd') || 'SO Najd Pharmacy Chain', [{ sku: 'SYR-5ML', qty: 400 }, { sku: 'THERM-DIG', qty: 100 }]);
    s3.picks = { alHayat: a.id, najd: n.id };
    for (const pk of [a, n]) { const c = await action(ctx, API('wh', `picks/${pk.id}/confirm`)); eq(c.status === 'Picked' ? 1 : 0, 1, pk.code + ' Picked (got ' + c.status + ')'); }
    refused(await F(ctx).post(API('wh', `picks/${a.id}/confirm`)), 'second confirmation');
    const { map } = await stockOf(ctx, JED);
    expectStock(map, { 'SM-3PLY': 1460, 'GLV-NIT-M': 680, 'SYR-5ML': 90, 'THERM-DIG': 40, 'GOWN-10': 58 }, 'JED after picks');
    return `${a.code} and ${n.code} Picked; JED SM 1,460, GLV 680, SYR 90, THERM 40, GOWN-10 58`;
  });
  manual('U3-11b', 'Reem\'s sales orders show Picked', 'Sales orders are workflow documents (ERP · Sales Order); a warehouse pick list is not linked to them by any API, so their status does not change. Check the order screen by eye.');

  await step('U3-12', 'Carrier FastLine, shipment FL-90211 In transit then Delivered, forecast SM-3PLY 1,000/month x 3', async () => {
    const car = await create(ctx, 'scm', 'carrier', { code: 'FASTLINE', data: { name: 'FastLine Logistics', mode: 'Road', phone: '+966500000000', rating: 85 } }, 'carrier');
    const shData = { type: 'Outbound', ref: soRef('alHayat') || 'Al-Hayat Clinics order', carrier: car.code, origin: 'Jeddah warehouse', destination: 'Riyadh - Al-Hayat Clinics', dispatched: ctx.today, eta: addDays(ctx.today, 7), tracking: 'FL-90211', cost: 0 };
    const sh = await create(ctx, 'scm', 'shipment', { branch: JED, data: shData }, 'shipment');
    eq(sh.status === 'Planned' ? 1 : 0, 1, 'shipment starts Planned');
    let r = await update(ctx, 'scm', 'shipment', sh.id, { status: 'InTransit', data: shData }, 'in transit');
    eq(r.status === 'InTransit' ? 1 : 0, 1, 'InTransit');
    r = await update(ctx, 'scm', 'shipment', sh.id, { status: 'Delivered', data: Object.assign({}, shData, { delivered: ctx.today }) }, 'delivered');
    eq(r.status === 'Delivered' ? 1 : 0, 1, 'Delivered');
    eq(r.data.tracking === 'FL-90211' ? 1 : 0, 1, 'tracking kept'); eq(r.data.delivered, ctx.today, 'delivered date');
    s3.shipment = sh.code;
    // forecast: three monthly records of 1,000 boxes
    const d0 = new Date(ctx.today + 'T00:00:00Z'); const periods = [0, 1, 2].map(i => { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1 + i, 1)); return d.toISOString().slice(0, 7); });
    for (const p of periods) await create(ctx, 'scm', 'forecast', { data: { sku: 'SM-3PLY', period: p, qty: 1000, method: 'Manual' } }, 'forecast ' + p);
    const fc = (await list(ctx, 'scm', 'forecast')).filter(f => f.data.sku === 'SM-3PLY');
    eq(fc.length, 3, 'forecast months'); eq(fc.reduce((s, f) => s + Number(f.data.qty), 0), 3000, 'forecast demand total');
    // reorder suggestion: SM stock after the first forecast month vs the item's reorder level
    const { rows } = await stockOf(ctx, JED); const sm = rows.find(x => x.sku === 'SM-3PLY');
    ok(sm, 'no SM-3PLY stock row in JED (depends on the goods receipt U3-06)');
    const prodSM = (must(await ctx.U.faisal.get('/api/pos/records/product'), 'products')).find(x => x.code === 'SM-3PLY'); sm.reorder = Number(((prodSM || {}).data || {}).reorder);
    eq(sm.reorder, 1000, 'SM-3PLY reorder level');
    const afterMonth1 = Number(sm.qty) - 1000;
    ok(afterMonth1 < Number(sm.reorder), `expected stock after month 1 (${afterMonth1}) to fall below the reorder level ${sm.reorder}`);
    return `${sh.code} Planned->InTransit->Delivered; forecast 3 x 1,000; stock ${sm.qty} falls to ${afterMonth1} (< 1,000) after month 1 -> reorder`;
  });
};

// ------------------------------------------------------------------ Day 4
exports.day4 = async function (ctx) {
  const s3 = S3(ctx), JED = ctx.branch.JED;

  await step('U3-13', 'Receive the remaining 50 THERM-DIG: Gulf order fully Received, THERM stock 90', async () => {
    const p = poRef(ctx, 'gulf', 'U3-04');
    const res = must(await F(ctx).post(API('proc', `pos/${p.id}/receive`), { lines: [{ sku: 'THERM-DIG', qty: 50 }], note: 'Balance' }), 'receive balance');
    eq(res.status === 'Received' ? 1 : 0, 1, 'Gulf order Received (the real status; the document calls it Closed). Got ' + res.status);
    for (const l of res.data.lines) eq(l.received, l.qty, 'fully received ' + l.sku);
    eq(res.data.receipts.length, 2, 'two receipt events on the order');
    const { map } = await stockOf(ctx, JED);
    expectStock(map, { 'THERM-DIG': 90 }, 'JED THERM');
    refused(await F(ctx).post(API('proc', `pos/${p.id}/receive`), { lines: [{ sku: 'THERM-DIG', qty: 1 }] }), 'receiving more than ordered');
    s3.gulfReceivedAt = new Date().toISOString();
    return `${p.code} Received; invoiceable now in full: 41,200 + VAT 6,180 = 47,380 (one bill, see notes)`;
  });

  await step('U3-14', 'Cycle count SM-3PLY at JED: system 1,460, counted 1,452, posted: -8 boxes = -64.00', async () => {
    const cnt = await create(ctx, 'wh', 'count', { branch: JED, data: { date: ctx.today, lines: [{ sku: 'SM-3PLY', counted: 1452, system: 1460, location: 'A-01' }] } }, 'create count');
    eq(cnt.status === 'Draft' ? 1 : 0, 1, 'count starts Draft');
    const pc = await action(ctx, API('wh', `counts/${cnt.id}/post`));
    eq(pc.status === 'Posted' ? 1 : 0, 1, 'count Posted'); eq(pc.data.varianceQty, -8, 'variance qty'); eq(pc.data.varianceValue, -64, 'variance value at cost');
    const { map } = await stockOf(ctx, JED);
    expectStock(map, { 'SM-3PLY': 1452 }, 'JED SM after count');
    refused(await F(ctx).post(API('wh', `counts/${cnt.id}/post`)), 'posting twice');
    s3.count = cnt.code;
    return `${cnt.code} posted: variance -8 (-64.00); stock 1,452. The API creates no GL journal for it (see notes)`;
  });

  await step('U3-15', 'Inventory document: transfer 200 SM-3PLY JED to RYD-HOSP, document history shows Faisal', async () => {
    let docErr = null, inst = null;
    const docNo = 'TRF-UAT-' + ctx.run;
    try {
      const defs = must(await F(ctx).get('/api/definitions'), 'definitions');
      const def = defs.find(d => /Stock Transfer/i.test(d.name) && /ERP/i.test(d.name)) || defs.find(d => /Stock Transfer/i.test(d.name));
      ok(def, 'no Stock Transfer workflow template visible');
      const total = 200 * 8;
      inst = must(await F(ctx).post('/api/instances/start', { definitionId: def.id, initialData: {
        docType: 'TRF', docNumber: docNo, module: 'inventory', company: ctx.company, branch: JED, warehouse: 'JED-MAIN', toWarehouse: 'RYD-HOSP', docDate: ctx.today,
        party: 'JED-MAIN -> RYD-HOSP', currency: 'SAR', lines: [{ item: 'SM-3PLY', description: 'Surgical mask 3-ply, box of 50', qty: 200, unit: 'box', unitPrice: 8, amount: total }],
        subtotal: total, total, requesterName: ctx.names.faisal.display } }), 'start stock transfer document');
      s3.trfDoc = inst.id;
      eq(String(inst.startedBy).toLowerCase(), me(ctx).toLowerCase(), 'document started by');
      const back = must(await F(ctx).get('/api/instances/' + inst.id), 'read document');
      ok(JSON.stringify(back.history || []).toLowerCase().includes(me(ctx).toLowerCase()) || String(back.startedBy).toLowerCase() === me(ctx).toLowerCase(), 'Faisal not in the document history');
    } catch (e) { docErr = e; }
    // the workflow document does not move stock by itself; the stock movement is the POS/warehouse transfer
    const t = must(await posCall(ctx, 'POST', '/api/pos/transfers', { company: ctx.company, fromBranch: JED, toBranch: ctx.branch.RYD, lines: [{ sku: 'SM-3PLY', qty: 200 }], note: 'Transfer to hospital store, doc ' + docNo }), 'transfer');
    must(await posCall(ctx, 'POST', `/api/pos/transfers/${t.id}/receive`), 'receive transfer');
    let { map } = await stockOf(ctx, JED); expectStock(map, { 'SM-3PLY': 1252 }, 'JED SM');
    ({ map } = await stockOf(ctx, ctx.branch.RYD)); expectStock(map, { 'SM-3PLY': 200 }, 'RYD SM');
    if (docErr) throw new Error('stock moved correctly (JED 1,252 / RYD 200) but the workflow document failed: ' + docErr.message);
    return `document ${inst.id} started by ${inst.startedBy}; transfer ${t.code}; JED SM 1,252, RYD 200`;
  });

  await step('U3-16', 'Calendar: decline Sara\'s Department heads meeting; free/busy for Tuesday 11:00', async () => {
    const m = ctx.S.meeting;
    if (!m || !m.id) throw new Error('depends on U5: ctx.S.meeting missing (Sara creates the Department heads meeting in u5.js)');
    const c = F(ctx);
    const from = new Date(Date.now() - 30 * 864e5).toISOString(), to = new Date(Date.now() + 120 * 864e5).toISOString();
    const evs = must(await c.get(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), 'my events');
    const ev = evs.find(e => e.id === m.id);
    ok(ev, 'Faisal does not see the meeting: he must be one of its attendees (username ' + me(ctx) + ')');
    const rv = must(await c.post(`/api/calendar/events/${m.id}/rsvp`, { response: 'no' }), 'decline');
    eq(rv.data.rsvp && rv.data.rsvp[me(ctx)] === 'no' ? 1 : 0, 1, 'decline stored in the meeting');
    // Sara sees the answer
    let saw = '';
    if (ctx.U.sara) {
      const se = must(await ctx.U.sara.get(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), 'Sara events');
      const sm = se.find(e => e.id === m.id); ok(sm, 'Sara does not see her own meeting');
      eq(sm.data.rsvp && sm.data.rsvp[me(ctx)] === 'no' ? 1 : 0, 1, 'Sara sees the decline'); saw = '; Sara sees the decline';
    }
    // free/busy for next Tuesday 11:00-12:00 Riyadh (08:00-09:00 UTC)
    const d = new Date(ctx.today + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 2);
    const day = d.toISOString().slice(0, 10), f = new Date(day + 'T08:00:00Z'), t = new Date(day + 'T09:00:00Z');
    const users = ['khalid', 'noura', 'faisal', 'reem', 'sara'].map(k => ctx.users[k]).filter(Boolean);
    const fb = must(await c.post('/api/calendar/freebusy', { users, from: f.toISOString(), to: t.toISOString() }), 'free/busy');
    for (const u of users) ok(Array.isArray(fb[u]) || Array.isArray(fb[u.toLowerCase()]), 'free/busy has no entry for ' + u);
    const free = users.filter(u => (fb[u] || []).length === 0);
    return `declined (no note field in API); Tuesday ${day} 11:00 free: ${free.join(', ') || 'nobody'}; busy: ${users.filter(u => !free.includes(u)).join(', ') || 'nobody'}${saw}`;
  });

  await step('U3-17', 'Purchase orders: requester Faisal, approved by Noura, times recorded', async () => {
    const note = await each(['gulf', 'eastern', 'packaging'], async k => {
      const p = poRef(ctx, k, 'U3-04/05');
      const r = await poStatus(ctx, p);
      eq(String(r.createdBy).toLowerCase(), me(ctx).toLowerCase(), p.code + ' requester');
      ok(['Approved', 'Sent', 'PartiallyReceived', 'Received', 'Invoiced'].includes(r.status), `${p.code} is ${r.status}: Noura's approval is missing`);
      ok(r.createdAt && r.updatedAt && new Date(r.updatedAt) >= new Date(r.createdAt), p.code + ' times missing');
      return `${p.code} ${r.status}`;
    });
    // the PO has no approver/comment fields: only the status and update time are recorded. Faisal as requester of a workflow document:
    const defs = must(await F(ctx).get('/api/definitions'), 'definitions');
    let wf = '', wfErr = null;
    try {
      const def = defs.find(d => /Purchase Requisition/i.test(d.name) && /ERP/i.test(d.name));
      ok(def, 'no Purchase Requisition workflow template visible');
      const g = ctx.S.pos && ctx.S.pos.gulf;
      const inst = must(await F(ctx).post('/api/instances/start', { definitionId: def.id, initialData: { docType: 'PR', docNumber: 'PR-UAT-' + ctx.run, module: 'purchasing', company: ctx.company, branch: JED, party: VENDOR.gulf, vendor: VENDOR.gulf, currency: 'SAR',
        po: g && g.code, total: 47380, notes: 'Within Q4 budget', requesterName: ctx.names.faisal.display } }), 'start requisition document');
      eq(String(inst.startedBy).toLowerCase(), me(ctx).toLowerCase(), 'workflow requester');
      wf = `workflow document ${inst.id} requester ${inst.startedBy}`;
    } catch (e) { wfErr = e; }
    if (wfErr) throw new Error('PO checks: ' + note + '; workflow requester check failed: ' + wfErr.message);
    return note + '; ' + wf;
  });
};
