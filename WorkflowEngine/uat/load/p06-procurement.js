// Procurement officer: requisition -> approval -> RFQ/award -> evaluation -> contract -> PO (from requisition and direct) ->
// approval by somebody else (workspace admin) -> send -> receive (partial, rest) -> supplier bill; refusals; summary; lookups.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = {
  id: 'procurement',
  title: 'Procurement officer',
  modules: ['proc'],
  role: 'procurement',
  // not proc.* : that would include proc.po.selfApprove and the self-approval refusal could not be tested
  perms: ['proc.view', 'proc.req.manage', 'proc.req.approve', 'proc.rfq.manage', 'proc.po.manage', 'proc.po.approve', 'proc.receive', 'proc.invoice',
    'proc.contracts.manage', 'proc.suppliers.manage', 'proc.reports.view', 'proc.setup', 'finance.ap.view', 'finance.ap.manage', 'wh.view'],
  probe: { path: '/api/erp/proc/records/po', perm: 'proc.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company, BR = u.ws.branch.JED, adm = u.ws.admin;
    const API = p => `/api/erp/proc/${p}`;
    const rec = k => API(`records/${k}`);
    const list = async (k, qs = '') => must(await c.get(rec(k) + '?take=5000' + qs), 'list ' + k);
    const mine = (arr, f) => arr.filter(x => f(x));
    const V1 = `VND-${K}`, V2 = `VNE-${K}`, A = `PA-${K}`, B = `PB-${K}`;
    const stockOf = async sku => { const rows = must(await c.get(`/api/erp/wh/wh-stock?branch=${BR}`), 'wh-stock'); return rows.filter(r => r.sku === sku).reduce((s, r) => s + num(r.qty), 0); };
    const reqLines = [{ sku: A, desc: 'Item A ' + K, qty: 100, price: 10 }, { sku: B, desc: 'Item B ' + K, qty: 50, price: 4 }];
    const reqData = { department: 'Procurement', needBy: u.ws.today, requester: u.username, reason: 'Stock ' + K, lines: reqLines };
    const poLine = (sku, qty, price, discountPct = 0) => ({ sku, desc: 'Line ' + sku, qty, price, discountPct, received: 0 });
    const mkPo = (vendor, lines, extra = {}) => c.post(rec('po'), { company: CO, branch: BR, ...extra, data: { vendor, date: u.ws.today, expected: u.ws.today, taxPct: 15, notes: 'PO ' + K, lines } });

    await u.step('P06-01', 'Master data: two suppliers (finance vendor records) appear in the procurement supplier lookup', async () => {
      for (const [code, nm] of [[V1, 'Supplier One '], [V2, 'Supplier Two ']])
        must(await c.post('/api/finance/records/vendor', { code, company: CO, status: 'Active', data: { name: nm + K, email: code.toLowerCase() + '@example.com', termsDays: 30, city: 'Riyadh' } }), 'create vendor ' + code);
      const lk = must(await c.get(API('lookups/vendors')), 'vendor lookup');
      for (const code of [V1, V2]) ok(lk.some(x => x.code === code && x.name.includes(K)), `supplier ${code} missing in lookups/vendors`);
      const me = must(await c.get(API('lookups/users')), 'user lookup'); ok(me.some(x => x.code === u.username), 'own user missing in lookups/users');
      refused(await c.get(API('lookups/nothing')), 'unknown lookup', [404]);
      return 'suppliers ' + V1 + ', ' + V2;
    });

    await u.step('P06-02', 'Requisition: starts Draft with PR- number, empty requisition refused, submit and approve', async () => {
      refused(await c.post(rec('requisition'), { company: CO, branch: BR, data: { department: 'Procurement', lines: [] } }), 'requisition without items', [400]);
      const rq = must(await c.post(rec('requisition'), { company: CO, branch: BR, data: reqData }), 'create requisition');
      ok(rq.status === 'Draft' && /^PR-/.test(rq.code), `status/code ${rq.status} ${rq.code}`);
      S.rq = rq;
      const sub = must(await c.put(rec('requisition') + '/' + rq.id, { status: 'Submitted', data: reqData }), 'submit'); ok(sub.status === 'Submitted', 'status ' + sub.status);
      const ap = must(await c.put(rec('requisition') + '/' + rq.id, { status: 'Approved', data: { ...reqData, approvedBy: u.username } }), 'approve'); ok(ap.status === 'Approved', 'status ' + ap.status);
      const back = (await list('requisition')).find(x => x.id === rq.id); eq(back.data.lines.length, 2, 'lines kept');
      return rq.code + ' Approved';
    });

    await u.step('P06-03', 'Requisition rejected and deleted; direct jump to Ordered refused', async () => {
      const rq = must(await c.post(rec('requisition'), { company: CO, branch: BR, data: { ...reqData, reason: 'Reject me ' + K } }), 'create');
      const rj = must(await c.put(rec('requisition') + '/' + rq.id, { status: 'Rejected', data: { ...reqData, reason: 'Reject me ' + K } }), 'reject'); ok(rj.status === 'Rejected', 'status ' + rj.status);
      refused(await c.put(rec('requisition') + '/' + rq.id, { status: 'Ordered', data: reqData }), 'set Ordered by hand', [400]);
      must(await c.del(rec('requisition') + '/' + rq.id), 'delete rejected requisition');
      ok(!(await list('requisition')).some(x => x.id === rq.id), 'deleted requisition still listed');
      return 'rejected, Ordered by hand refused, deleted';
    });

    await u.step('P06-04', 'RFQ: two quotes, sent, awarded to the cheaper supplier', async () => {
      const data = { title: 'RFQ ' + K, due: u.ws.today, lines: [{ sku: A, qty: 100, target: 10 }], quotes: [{ vendor: V1, amount: 1000, leadDays: 5, note: '10.00 each' }, { vendor: V2, amount: 1100, leadDays: 3, note: '11.00 each' }] };
      const rfq = must(await c.post(rec('rfq'), { company: CO, branch: BR, data }), 'create rfq'); ok(/^RFQ-/.test(rfq.code) && rfq.status === 'Draft', `rfq ${rfq.code} ${rfq.status}`);
      let r = must(await c.put(rec('rfq') + '/' + rfq.id, { status: 'Sent', data }), 'send'); ok(r.status === 'Sent', r.status);
      const best = data.quotes.reduce((a, b) => (b.amount < a.amount ? b : a));
      r = must(await c.put(rec('rfq') + '/' + rfq.id, { status: 'Awarded', data: { ...data, awarded: best.vendor } }), 'award'); ok(r.status === 'Awarded', r.status);
      eq(best.vendor === V1 ? 1 : 0, 1, 'cheapest quote is supplier one'); S.rfq = rfq;
      const back = (await list('rfq')).find(x => x.id === rfq.id); ok(back.data.awarded === V1 && back.data.quotes.length === 2, 'award or quotes not stored');
      return rfq.code + ' awarded to ' + V1;
    });

    await u.step('P06-05', 'Supplier evaluation 60/40 weights: V1 84.00, V2 94.55, faster supplier ranks first (numeric)', async () => {
      const q = [{ vendor: V1, amount: 1000, lead: 5 }, { vendor: V2, amount: 1100, lead: 3 }];
      const minA = Math.min(...q.map(x => x.amount)), minL = Math.min(...q.map(x => x.lead));
      for (const x of q) {
        const price = r2(minA / x.amount * 100), delivery = r2(minL / x.lead * 100), weighted = r2(price * 0.6 + delivery * 0.4);
        must(await c.post(rec('evaluation'), { company: CO, data: { vendor: x.vendor, period: u.ws.today.slice(0, 7), quality: 80, service: 80, price, delivery, weightPrice: 60, weightDelivery: 40, weighted, rfq: S.rfq ? S.rfq.code : 'n/a' } }), 'evaluation ' + x.vendor);
      }
      const ev = (await list('evaluation')).filter(e => e.data && [V1, V2].includes(e.data.vendor)).sort((a, b) => num(b.data.weighted) - num(a.data.weighted));
      eq(ev.length, 2, 'evaluations');
      // V1: price 100.00, delivery 3/5 = 60.00 -> 84.00 ; V2: price 90.91, delivery 100.00 -> 94.55 (54.546 + 40)
      const w = v => num((ev.find(e => e.data.vendor === v) || { data: {} }).data.weighted);
      eq(w(V1), 84, 'V1 weighted'); eq(w(V2), 94.55, 'V2 weighted'); ok(ev[0].data.vendor === V2, 'faster supplier should rank first, got ' + ev[0].data.vendor);
      return `V2 ${w(V2)} ranks above V1 ${w(V1)}`;
    });

    await u.step('P06-06', 'Contract with the awarded supplier: Active, value 50,000, edited and expiring flag in summary', async () => {
      const data = { title: 'Framework ' + K, vendor: V1, start: u.ws.today, end: u.ws.today, value: 50000, terms: 'Net 30' };
      const con = must(await c.post(rec('contract'), { company: CO, data }), 'create contract'); ok(con.status === 'Active' && /^CON-/.test(con.code), `contract ${con.code} ${con.status}`);
      eq(con.data.value, 50000, 'ceiling');
      const up = must(await c.put(rec('contract') + '/' + con.id, { status: 'Active', data: { ...data, value: 60000 } }), 'edit contract'); eq(up.data.value, 60000, 'new ceiling');
      S.contract = con;
      return con.code + ' value 60,000';
    });

    await u.step('P06-07', 'PO from the approved requisition: 1,000 + 200 = 1,200 + VAT 180 = 1,380; requisition Ordered; second conversion refused', async () => {
      ok(S.rq, 'depends on P06-02');
      const po = must(await c.post(API(`requisitions/${S.rq.id}/topo`), { vendor: V1 }), 'requisition to PO');
      ok(po.status === 'Draft' && /^PO-/.test(po.code), `po ${po.code} ${po.status}`);
      eq(po.data.amount, 1200, 'subtotal'); eq(po.data.taxAmount, 180, 'VAT'); eq(po.data.total, 1380, 'total'); eq(po.data.lines.length, 2, 'lines');
      S.po1 = po;
      const rq = (await list('requisition')).find(x => x.id === S.rq.id); ok(rq.status === 'Ordered', 'requisition status ' + rq.status);
      refused(await c.post(API(`requisitions/${S.rq.id}/topo`), { vendor: V1 }), 'second conversion', [400]);
      return po.code + ' 1,380.00';
    });

    await u.step('P06-08', 'Requisition without a supplier cannot become a PO (empty supplier refused); draft requisition cannot be converted', async () => {
      const rq = must(await c.post(rec('requisition'), { company: CO, branch: BR, data: reqData }), 'create');
      refused(await c.post(API(`requisitions/${rq.id}/topo`), { vendor: V1 }), 'conversion of a Draft requisition', [400]);
      must(await c.put(rec('requisition') + '/' + rq.id, { status: 'Approved', data: reqData }), 'approve');
      const r = refused(await c.post(API(`requisitions/${rq.id}/topo`), {}), 'empty supplier', [400]); ok(/supplier/i.test(r.text), 'message: ' + r.text);
      refused(await c.post(API(`requisitions/${rq.id}/topo`), { vendor: '' }), 'blank supplier', [400]);
      return 'refused (400) both times';
    });

    await u.step('P06-09', 'Direct PO with 10% line discount: 10 x 5 less 10% = 45.00 + VAT 6.75 = 51.75; invalid POs refused', async () => {
      refused(await mkPo('', [poLine(A, 1, 1)]), 'PO without supplier', [400]);
      refused(await mkPo(V1, []), 'PO without lines', [400]);
      refused(await mkPo(V1, [poLine(A, -5, 1)]), 'negative quantity', [400]);
      refused(await mkPo(V1, [poLine(A, 0, 1)]), 'zero quantity', [400]);
      refused(await mkPo(V1, [poLine(A, 1, -1)]), 'negative price', [400]);
      refused(await mkPo(V1, [poLine(A, 1, 1)], { status: 'Approved' }), 'PO created already Approved', [400]);
      const po = must(await mkPo(V1, [poLine(A, 10, 5, 10)]), 'create PO');
      eq(po.data.amount, 45, 'subtotal'); eq(po.data.taxAmount, 6.75, 'VAT'); eq(po.data.total, 51.75, 'total'); ok(po.status === 'Draft', po.status);
      S.po2 = po;
      refused(await c.put(rec('po') + '/' + po.id, { status: 'Approved', data: po.data }), 'status change by hand', [400]);
      return po.code + ' 51.75; 6 refusals';
    });

    await u.step('P06-10', 'Approval needs somebody else: self approval refused, send before approval refused, admin approves', async () => {
      ok(S.po1 && S.po2, 'depends on P06-07/09');
      const s = refused(await c.post(API(`pos/${S.po1.id}/approve`)), 'self approval', [400, 403]); ok(/else|approve/i.test(s.text) || s.status === 403, 'message: ' + s.text);
      refused(await c.post(API(`pos/${S.po1.id}/send`)), 'send a draft', [400]);
      refused(await c.post(API(`pos/${S.po1.id}/receive`)), 'receive a draft', [400]);
      for (const p of [S.po1, S.po2]) { const a = must(await adm.post(API(`pos/${p.id}/approve`)), 'admin approves ' + p.code); ok(a.status === 'Approved', 'status ' + a.status); }
      refused(await adm.post(API(`pos/${S.po1.id}/approve`)), 'approve twice', [400]);
      const sd = must(await c.post(API(`pos/${S.po1.id}/send`)), 'send'); ok(sd.status === 'Sent', sd.status);
      return 'both approved by admin, ' + S.po1.code + ' sent';
    });

    await u.step('P06-11', 'Receive PO 1 in two goes: 60 of A (PartiallyReceived, stock 60), over-receipt refused, rest -> Received, stock A 100 / B 50', async () => {
      ok(S.po1, 'depends on P06-07');
      const r1 = must(await c.post(API(`pos/${S.po1.id}/receive`), { lines: [{ sku: A, qty: 60 }], note: 'part ' + K }), 'receive part');
      ok(r1.status === 'PartiallyReceived', 'status ' + r1.status); eq(r1.data.lines.find(l => l.sku === A).received, 60, 'A received'); eq(await stockOf(A), 60, 'stock A');
      refused(await c.post(API(`pos/${S.po1.id}/receive`), { lines: [{ sku: A, qty: 50 }] }), 'over-receipt', [400]);
      refused(await c.post(API(`pos/${S.po1.id}/receive`), { lines: [{ sku: 'NOPE-' + K, qty: 1 }] }), 'sku not on the order', [400]);
      eq(await stockOf(A), 60, 'stock unchanged after refusals');
      const r2_ = must(await c.post(API(`pos/${S.po1.id}/receive`), { note: 'rest ' + K }), 'receive rest');
      ok(r2_.status === 'Received', 'status ' + r2_.status); eq(r2_.data.receipts.length, 2, 'receipt events');
      for (const l of r2_.data.lines) eq(l.received, l.qty, 'fully received ' + l.sku);
      eq(await stockOf(A), 100, 'stock A'); eq(await stockOf(B), 50, 'stock B');
      refused(await c.post(API(`pos/${S.po1.id}/receive`)), 'receive a closed order', [400]);
      return 'stock A 100, B 50';
    });

    await u.step('P06-12', 'Supplier bill: PO 1 received -> invoice action makes a Draft AP bill 1,200 + 180 = 1,380; PO becomes Invoiced; no second bill', async () => {
      ok(S.po1, 'depends on P06-07');
      refused(await c.post(API(`pos/${S.po2.id}/invoice`)), 'invoice before receipt', [400]);
      const inv = must(await c.post(API(`pos/${S.po1.id}/invoice`)), 'invoice'); ok(inv.status === 'Invoiced' && inv.data.invoice, `status ${inv.status} bill ${inv.data.invoice}`);
      const bills = must(await c.get('/api/finance/records/apinvoice'), 'ap bills'); const b = bills.find(x => x.code === inv.data.invoice); ok(b, 'bill not in payables');
      ok(b.status === 'Draft', 'bill status ' + b.status); eq(b.data.amount, 1200, 'bill net'); eq(b.data.taxAmount, 180, 'bill VAT'); eq(b.data.total, 1380, 'bill total'); ok(b.data.vendor === V1, 'bill vendor');
      refused(await c.post(API(`pos/${S.po1.id}/invoice`)), 'second invoice', [400]);
      refused(await c.del(rec('po') + '/' + S.po1.id), 'delete an invoiced PO', [400]);
      return `${b.code} 1,380.00`;
    });

    await u.step('P06-13', 'PO 2 partly received (4 of 10) can no longer be cancelled; a fresh PO can be cancelled once and deleted when draft', async () => {
      ok(S.po2, 'depends on P06-09');
      const r = must(await c.post(API(`pos/${S.po2.id}/receive`), { lines: [{ sku: A, qty: 4 }] }), 'receive 4'); ok(r.status === 'PartiallyReceived', r.status); eq(r.data.lines[0].received, 4, 'received');
      refused(await c.post(API(`pos/${S.po2.id}/cancel`)), 'cancel a partly received PO', [400]);
      const p3 = must(await mkPo(V2, [poLine(B, 5, 4)]), 'create PO 3'); eq(p3.data.total, 23, '5 x 4 + VAT 3');
      const cn = must(await c.post(API(`pos/${p3.id}/cancel`)), 'cancel'); ok(cn.status === 'Cancelled', cn.status);
      refused(await c.post(API(`pos/${p3.id}/cancel`)), 'cancel twice', [400]);
      const p4 = must(await mkPo(V2, [poLine(B, 1, 4)]), 'create PO 4'); must(await c.del(rec('po') + '/' + p4.id), 'delete draft PO');
      ok(!(await list('po')).some(x => x.id === p4.id), 'deleted PO still listed');
      return 'PO2 4/10, PO3 cancelled, PO4 deleted';
    });

    await u.step('P06-14', 'Overview: spend by supplier for V1 = 1,380 + 51.75 = 1,431.75 (cancelled PO excluded); PO status counts; spend month', async () => {
      const sm = must(await c.get(API('summary')), 'proc summary');
      const kp = k => num(((sm.kpis || []).find(x => x.k === k) || {}).v);
      const rows = k => ((sm.lists || []).find(x => x.k === k) || { rows: [] }).rows;
      const row = (rows('spendByVendor').find(x => x.name === V1) || {});
      eq(row.value, 1431.75, 'spend with ' + V1);
      const st = n => num((rows('poByStatus').find(x => x.name === n) || {}).value || 0);
      ok(st('Invoiced') >= 1 && st('PartiallyReceived') >= 1 && st('Cancelled') >= 1, 'poByStatus lacks Invoiced/PartiallyReceived/Cancelled');
      ok(kp('spendMonth') >= 1431.75 - 0.005, 'spendMonth ' + kp('spendMonth')); ok(kp('openPo') >= 1, 'openPo ' + kp('openPo')); ok(kp('awaitingReceipt') >= 1, 'awaitingReceipt ' + kp('awaitingReceipt'));
      ok(kp('contractsExpiring') >= 1, 'contract ending today should count as expiring: ' + kp('contractsExpiring'));
      return `V1 spend ${row.value}, spendMonth ${kp('spendMonth')}`;
    });

    await u.step('P06-15', 'Lists: every kind is listed with my records; filter by status; unknown kind refused', async () => {
      const pos = await list('po'); ok(S.po1 && pos.some(x => x.id === S.po1.id && x.status === 'Invoiced'), 'PO1 not listed as Invoiced');
      const inv = must(await c.get(rec('po') + '?status=Invoiced&take=5000'), 'filtered list'); ok(inv.length >= 1 && inv.every(x => x.status === 'Invoiced'), 'status filter');
      for (const k of ['requisition', 'rfq', 'contract', 'evaluation']) ok((await list(k)).length >= 1, 'no ' + k + ' listed');
      refused(await c.get(API('records/nothing')), 'unknown kind', [404]);
      return 'lists ok';
    });
  },
};
