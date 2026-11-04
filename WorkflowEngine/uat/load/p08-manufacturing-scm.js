// Production and supply-chain planner: own items and stock, work centre, machine, BOM (with refused designs), MRP, work-order lifecycle with scrap,
// costing, quality inspections, maintenance, overview; carrier, shipment lifecycle, demand forecast, SCM overview.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = {
  id: 'mfg-scm',
  title: 'Production and supply-chain planner',
  modules: ['mfg', 'scm'],
  role: 'employee',
  perms: ['mfg.*', 'scm.*', 'pos.products.manage', 'pos.stock.manage', 'pos.stock.view', 'wh.view'],
  probe: { path: '/api/erp/mfg/records/workorder', perm: 'mfg.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company, JED = u.ws.branch.JED;
    const M = (m, p) => `/api/erp/${m}/${p}`;
    const rec = (m, k) => M(m, `records/${k}`);
    const list = async (m, k, qs = '') => must(await c.get(rec(m, k) + '?take=5000' + qs), `list ${m}/${k}`);
    const R1 = `RM1-${K}`, R2 = `RM2-${K}`, FG = `FG-${K}`, WC = `WC-${K}`, MC = `MC-${K}`, CAR = `CAR-${K}`;
    const stockMap = async () => { const rows = must(await c.get(M('mfg', `stock?branch=${JED}`)), 'mfg stock'); const m = {}; for (const r of rows) m[r.sku] = num(r.qty); return m; };
    const kp = (sm, k) => num(((sm.kpis || []).find(x => x.k === k) || {}).v);
    const rows = (sm, k) => ((sm.lists || []).find(x => x.k === k) || { rows: [] }).rows;
    const bomData = { name: 'Product ' + K, qty: 1, workCenter: WC, routingMinutes: 1.2, lines: [{ sku: R1, qty: 4, scrapPct: 0 }, { sku: R2, qty: 10, scrapPct: 0 }] };
    const woBody = (qty, extra = {}) => ({ company: CO, branch: JED, data: { sku: FG, qty, due: u.ws.today, priority: 'Normal', workCenter: WC, lines: bomData.lines, bomQty: 1, routingMinutes: 1.2, ...extra } });

    await u.step('P08-01', 'Own items (2 raw materials, 1 finished) and opening stock R1 500 / R2 1,200; item and stock lookups agree', async () => {
      for (const [code, name, cost, price] of [[R1, 'Raw one ', 2.5, 0], [R2, 'Raw two ', 0.5, 0], [FG, 'Finished ', 0, 30]])
        must(await c.post('/api/pos/records/product', { code, company: CO, status: 'Active', data: { name: name + K, unit: 'pcs', cost, price, trackStock: true, reorder: 0 } }), 'create item ' + code);
      must(await c.post('/api/pos/stock/adjust', { company: CO, branch: JED, sku: R1, delta: 500, reason: 'opening ' + K }), 'stock R1');
      must(await c.post('/api/pos/stock/adjust', { company: CO, branch: JED, sku: R2, delta: 1200, reason: 'opening ' + K }), 'stock R2');
      const items = must(await c.get(M('mfg', 'items')), 'items');
      eq(items.find(i => i.sku === R1).cost, 2.5, 'R1 cost'); eq(items.find(i => i.sku === R2).cost, 0.5, 'R2 cost'); ok(items.some(i => i.sku === FG), 'FG missing');
      const st = await stockMap(); eq(st[R1], 500, 'R1 stock'); eq(st[R2], 1200, 'R2 stock'); eq(st[FG] || 0, 0, 'FG stock');
      return 'R1 500, R2 1200, FG 0';
    });

    await u.step('P08-02', 'Setup: manufacturing defaults (overhead 20%), work centre 60/h, machine; duplicates and missing code refused', async () => {
      const sets = await list('mfg', 'setting'); const d = sets.find(s => s.code === 'defaults'); const cfg = { overheadPct: 20, allowNegativeStock: false };
      if (d) must(await c.put(rec('mfg', 'setting') + '/' + d.id, { status: 'Active', data: { ...d.data, ...cfg } }), 'update defaults'); else must(await c.post(rec('mfg', 'setting'), { code: 'defaults', company: CO, status: 'Active', data: cfg }), 'create defaults');
      must(await c.post(rec('mfg', 'workcenter'), { code: WC, company: CO, branch: JED, status: 'Active', data: { name: 'Line ' + K, costPerHour: 60, capacityHours: 8 } }), 'work centre');
      refused(await c.post(rec('mfg', 'workcenter'), { code: WC, company: CO, data: { name: 'dup' } }), 'duplicate work centre', [409]);
      refused(await c.post(rec('mfg', 'workcenter'), { company: CO, data: { name: 'no code' } }), 'work centre without code', [400]);
      const mc = must(await c.post(rec('mfg', 'machine'), { code: MC, company: CO, branch: JED, status: 'Active', data: { name: 'Press ' + K, workCenter: WC, serial: 'SN' + u.tag, purchaseCost: 5000 } }), 'machine');
      const up = must(await c.put(rec('mfg', 'machine') + '/' + mc.id, { status: 'Down', data: mc.data }), 'machine down'); ok(up.status === 'Down', up.status);
      must(await c.put(rec('mfg', 'machine') + '/' + mc.id, { status: 'Active', data: mc.data }), 'machine back');
      ok((await list('mfg', 'workcenter')).some(w => w.code === WC && num(w.data.costPerHour) === 60), 'work centre not listed');
      return 'WC ' + WC + ', machine ' + MC;
    });

    await u.step('P08-03', 'BOM: 4 R1 + 10 R2 per unit saved; invalid designs refused (no components, itself, zero qty, circular, duplicate)', async () => {
      refused(await c.post(rec('mfg', 'bom'), { code: FG, company: CO, data: { ...bomData, lines: [] } }), 'BOM without components', [400]);
      refused(await c.post(rec('mfg', 'bom'), { code: FG, company: CO, data: { ...bomData, lines: [{ sku: FG, qty: 1 }] } }), 'BOM containing itself', [400]);
      refused(await c.post(rec('mfg', 'bom'), { code: FG, company: CO, data: { ...bomData, lines: [{ sku: R1, qty: 0 }] } }), 'zero component qty', [400]);
      refused(await c.post(rec('mfg', 'bom'), { code: FG, company: CO, data: { ...bomData, qty: 0 } }), 'zero produced qty', [400]);
      const bom = must(await c.post(rec('mfg', 'bom'), { code: FG, company: CO, branch: JED, data: bomData }), 'create BOM'); S.bom = bom;
      refused(await c.post(rec('mfg', 'bom'), { code: FG, company: CO, data: bomData }), 'duplicate BOM', [409]);
      refused(await c.post(rec('mfg', 'bom'), { code: R1, company: CO, data: { name: 'loop', qty: 1, lines: [{ sku: FG, qty: 1 }] } }), 'circular BOM', [400]);
      const up = must(await c.put(rec('mfg', 'bom') + '/' + bom.id, { data: { ...bomData, name: 'Product v2 ' + K } }), 'edit BOM'); ok(up.data.name === 'Product v2 ' + K, 'name');
      eq(up.data.lines.length, 2, 'components kept');
      return 'BOM ' + FG + ' saved, 5 invalid designs refused';
    });

    await u.step('P08-04', 'Standard cost per unit: material 15.00 + labour 1.20 + overhead 0.24 = 16.44; x100 = 1,644.00', async () => {
      const items = must(await c.get(M('mfg', 'items')), 'items'); const cost = s => items.find(i => i.sku === s).cost;
      const material = bomData.lines.reduce((a, l) => a + l.qty * cost(l.sku), 0), labor = r2(bomData.routingMinutes / 60 * 60), overhead = r2(labor * 20 / 100);
      eq(material, 15, 'material per unit'); eq(labor, 1.2, 'labour'); eq(overhead, 0.24, 'overhead'); eq(r2(material + labor + overhead), 16.44, 'standard per unit'); eq(r2((material + labor + overhead) * 100), 1644, 'standard x100');
      return 'standard 16.44';
    });

    await u.step('P08-05', 'MRP (net of stock): demand 100 is fully covered; demand 200 needs 300 more R1 and 800 more R2', async () => {
      const st = await stockMap();
      const need = d => bomData.lines.map(l => ({ sku: l.sku, gross: l.qty * d, onHand: st[l.sku] || 0, net: Math.max(0, l.qty * d - (st[l.sku] || 0)) }));
      for (const n of need(100)) eq(n.net, 0, 'net ' + n.sku + ' for 100');
      const n2 = need(200); eq(n2.find(x => x.sku === R1).gross, 800, 'gross R1'); eq(n2.find(x => x.sku === R1).net, 300, 'buy R1'); eq(n2.find(x => x.sku === R2).gross, 2000, 'gross R2'); eq(n2.find(x => x.sku === R2).net, 800, 'buy R2');
      return 'buy 300 R1 + 800 R2 for 200 units';
    });

    await u.step('P08-06', 'Work order lifecycle: invalid refused; Planned -> Released -> InProgress; out-of-order actions refused', async () => {
      refused(await c.post(rec('mfg', 'workorder'), woBody(0)), 'quantity 0', [400]);
      refused(await c.post(rec('mfg', 'workorder'), { company: CO, branch: JED, data: { qty: 5, lines: bomData.lines } }), 'no product', [400]);
      const wo = must(await c.post(rec('mfg', 'workorder'), woBody(100, { source: 'MRP' })), 'create work order'); ok(wo.status === 'Planned' && /^WO-/.test(wo.code), `${wo.code} ${wo.status}`); S.wo = wo;
      refused(await c.post(M('mfg', `workorders/${wo.id}/start`)), 'start before release', [400]);
      refused(await c.post(M('mfg', `workorders/${wo.id}/complete`), { qty: 1 }), 'complete before start', [400]);
      refused(await c.put(rec('mfg', 'workorder') + '/' + wo.id, { status: 'Released', data: wo.data }), 'status by hand', [400]);
      let r = must(await c.post(M('mfg', `workorders/${wo.id}/release`)), 'release'); ok(r.status === 'Released', r.status);
      refused(await c.post(M('mfg', `workorders/${wo.id}/release`)), 'release twice', [400]);
      r = must(await c.post(M('mfg', `workorders/${wo.id}/start`)), 'start'); ok(r.status === 'InProgress', r.status); ok(r.data.startedBy === u.username, 'startedBy');
      refused(await c.post(M('mfg', `workorders/${wo.id}/cancel`)), 'cancel in progress', [400]);
      refused(await c.post(M('mfg', `workorders/${wo.id}/nonsense`)), 'unknown action', [404]);
      return wo.code + ' InProgress';
    });

    await u.step('P08-07', 'Complete 100 units: 95 good + 5 scrap, 2.5 h: consumes R1 400 / R2 1,000, FG +95; negative hours refused', async () => {
      ok(S.wo, 'depends on P08-06');
      refused(await c.post(M('mfg', `workorders/${S.wo.id}/complete`), { qty: 95, scrap: 5, hours: -1 }), 'negative hours', [400]);
      eq((await stockMap())[R1], 500, 'stock untouched after refusal');
      const r = must(await c.post(M('mfg', `workorders/${S.wo.id}/complete`), { qty: 95, scrap: 5, hours: 2.5, note: 'run ' + K }), 'complete'); ok(r.status === 'Completed', r.status);
      eq(r.data.goodQty, 95, 'good'); eq(r.data.scrapQty, 5, 'scrap');
      const st = await stockMap(); eq(st[R1], 100, 'R1 left'); eq(st[R2], 200, 'R2 left'); eq(st[FG], 95, 'FG good receipts');
      return 'R1 100, R2 200, FG 95';
    });

    await u.step('P08-08', 'Costing: material 1,500 + labour 150 + overhead 30 = 1,680; unit cost 17.68; standard 1,644, variance 36; FG item cost 17.68', async () => {
      ok(S.wo, 'depends on P08-06');
      const w = (await list('mfg', 'workorder')).find(x => x.id === S.wo.id), d = w.data;
      eq(d.materialCost, 1500, 'material'); eq(d.laborCost, 150, 'labour'); eq(d.overheadCost, 30, 'overhead'); eq(d.actualCost, 1680, 'actual'); eq(d.unitCost, 17.68, 'unit cost');
      eq(d.standardCost, 1644, 'standard'); eq(d.variance, 36, 'variance'); eq(d.consumed.length, 2, 'consumed lines'); eq(d.consumed.find(x => x.sku === R2).qty, 1000, 'R2 issued');
      const it = must(await c.get(M('mfg', 'items')), 'items').find(i => i.sku === FG); eq(it.cost, 17.68, 'FG moving-average cost');
      return 'actual 1680, unit 17.68, variance 36';
    });

    await u.step('P08-09', 'Finished orders are protected: edit, delete, cancel of a Completed order refused; Planned order can be cancelled; not enough material refused', async () => {
      ok(S.wo, 'depends on P08-06');
      refused(await c.put(rec('mfg', 'workorder') + '/' + S.wo.id, { data: { ...S.wo.data, qty: 5 } }), 'edit completed', [400]);
      refused(await c.del(rec('mfg', 'workorder') + '/' + S.wo.id), 'delete completed', [400]);
      refused(await c.post(M('mfg', `workorders/${S.wo.id}/cancel`)), 'cancel completed', [400]);
      const w3 = must(await c.post(rec('mfg', 'workorder'), woBody(10)), 'create planned'); const cn = must(await c.post(M('mfg', `workorders/${w3.id}/cancel`)), 'cancel'); ok(cn.status === 'Cancelled', cn.status);
      refused(await c.post(M('mfg', `workorders/${w3.id}/cancel`)), 'cancel twice', [400]);
      const big = must(await c.post(rec('mfg', 'workorder'), woBody(1000)), 'create big'); must(await c.post(M('mfg', `workorders/${big.id}/release`)), 'release'); must(await c.post(M('mfg', `workorders/${big.id}/start`)), 'start');
      const r = refused(await c.post(M('mfg', `workorders/${big.id}/complete`), { qty: 1000, hours: 1 }), 'not enough material', [400]); ok(/not enough/i.test(r.text), 'message: ' + r.text);
      const st = await stockMap(); eq(st[R1], 100, 'R1 unchanged'); eq(st[FG], 95, 'FG unchanged'); S.big = big;
      return 'refusals ok: ' + r.text.slice(0, 70);
    });

    await u.step('P08-10', 'Quality: inspection of the order Pending -> Passed, a second one Failed with 3 defects; auto QC numbers', async () => {
      ok(S.wo, 'depends on P08-06');
      const base = { type: 'Final', sku: FG, qty: 100, sample: 20, inspector: u.username, date: u.ws.today };
      const q1 = must(await c.post(rec('mfg', 'inspection'), { company: CO, branch: JED, ref: S.wo.code, data: { ...base, defects: 0 } }), 'inspection 1'); ok(q1.status === 'Pending' && /^QC-/.test(q1.code), `${q1.code} ${q1.status}`);
      const p = must(await c.put(rec('mfg', 'inspection') + '/' + q1.id, { status: 'Passed', data: q1.data }), 'pass'); ok(p.status === 'Passed', p.status);
      const q2 = must(await c.post(rec('mfg', 'inspection'), { company: CO, branch: JED, ref: S.wo.code, status: 'Failed', data: { ...base, defects: 3, notes: 'stitching ' + K } }), 'inspection 2'); eq(q2.data.defects, 3, 'defects');
      const mine = (await list('mfg', 'inspection', '&ref=' + encodeURIComponent(S.wo.code))); eq(mine.length, 2, 'inspections of the order');
      eq(mine.filter(x => x.status === 'Passed').length, 1, 'passed'); eq(mine.filter(x => x.status === 'Failed').length, 1, 'failed');
      return `${q1.code} Passed, ${q2.code} Failed`;
    });

    await u.step('P08-11', 'Maintenance on the machine: Open (auto MT number) -> InProgress -> Done with cost 120', async () => {
      const m = must(await c.post(rec('mfg', 'maintenance'), { company: CO, branch: JED, data: { machine: MC, type: 'Preventive', due: u.ws.today, cost: 0, description: 'Lubrication ' + K } }), 'maintenance'); ok(m.status === 'Open' && /^MT-/.test(m.code), `${m.code} ${m.status}`);
      let r = must(await c.put(rec('mfg', 'maintenance') + '/' + m.id, { status: 'InProgress', data: m.data }), 'in progress'); ok(r.status === 'InProgress', r.status);
      r = must(await c.put(rec('mfg', 'maintenance') + '/' + m.id, { status: 'Done', data: { ...m.data, cost: 120, doneAt: u.ws.today } }), 'done'); ok(r.status === 'Done', r.status); eq(r.data.cost, 120, 'cost');
      const open = must(await c.post(rec('mfg', 'maintenance'), { company: CO, branch: JED, data: { machine: MC, type: 'Corrective', due: u.ws.today } }), 'second'); ok(open.status === 'Open', 'second Open');
      return m.code + ' Done 120';
    });

    await u.step('P08-12', 'Manufacturing overview: FG produced 95 in byProduct, completed orders, cost/variance/scrap totals cover my order, open maintenance', async () => {
      const sm = must(await c.get(M('mfg', 'summary')), 'mfg summary');
      eq((rows(sm, 'byProduct').find(x => x.name === FG) || {}).value, 95, 'produced FG');
      ok(num((rows(sm, 'byStatus').find(x => x.name === 'Completed') || {}).value) >= 1, 'byStatus lacks Completed'); ok(num((rows(sm, 'byStatus').find(x => x.name === 'InProgress') || {}).value) >= 1, 'byStatus lacks InProgress (big order)');
      ok(kp(sm, 'producedMonth') >= 95, 'producedMonth ' + kp(sm, 'producedMonth')); ok(kp(sm, 'scrapMonth') >= 5, 'scrapMonth ' + kp(sm, 'scrapMonth')); ok(kp(sm, 'costMonth') >= 1680 - 0.005, 'costMonth ' + kp(sm, 'costMonth'));
      ok(kp(sm, 'variance') >= 36 - 0.005, 'variance ' + kp(sm, 'variance')); ok(kp(sm, 'inProgress') >= 1, 'inProgress'); ok(kp(sm, 'maintenanceOpen') >= 1, 'maintenanceOpen'); ok(kp(sm, 'passRate') > 0 && kp(sm, 'passRate') < 100, 'passRate ' + kp(sm, 'passRate'));
      return `produced ${kp(sm, 'producedMonth')}, cost ${kp(sm, 'costMonth')}, passRate ${kp(sm, 'passRate')}`;
    });

    await u.step('P08-13', 'Carrier and shipment lifecycle: Planned -> Dispatched -> InTransit -> Delivered with date; duplicate carrier refused', async () => {
      const car = must(await c.post(rec('scm', 'carrier'), { code: CAR, company: CO, status: 'Active', data: { name: 'Carrier ' + K, mode: 'Road', phone: '05' + u.tag, rating: 85 } }), 'carrier');
      refused(await c.post(rec('scm', 'carrier'), { code: CAR, company: CO, data: { name: 'dup' } }), 'duplicate carrier', [409]);
      const sh = { type: 'Outbound', ref: 'ORD-' + K, carrier: CAR, origin: 'Jeddah', destination: 'Riyadh', dispatched: u.ws.today, eta: u.ws.today, tracking: 'TRK-' + K, cost: 150 };
      const s = must(await c.post(rec('scm', 'shipment'), { company: CO, branch: JED, data: sh }), 'shipment'); ok(s.status === 'Planned' && /^SH-/.test(s.code), `${s.code} ${s.status}`);
      for (const st of ['Dispatched', 'InTransit']) { const r = must(await c.put(rec('scm', 'shipment') + '/' + s.id, { status: st, data: sh }), st); ok(r.status === st, r.status); }
      const d = must(await c.put(rec('scm', 'shipment') + '/' + s.id, { status: 'Delivered', data: { ...sh, delivered: u.ws.today } }), 'delivered'); ok(d.status === 'Delivered', d.status); eq(d.data.tracking === 'TRK-' + K ? 1 : 0, 1, 'tracking kept'); eq(d.data.delivered, u.ws.today, 'delivered date');
      eq(d.data.cost, 150, 'cost'); S.ship = d; ok((await list('scm', 'carrier')).some(x => x.code === CAR), 'carrier not listed');
      return `${s.code} Delivered`;
    });

    await u.step('P08-14', 'Late shipment: eta two days ago and still InTransit counts as delayed; cancelled shipment; delete', async () => {
      const past = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
      const sh = { type: 'Inbound', ref: 'LATE-' + K, carrier: CAR, destination: 'Jeddah', dispatched: past, eta: past };
      const s = must(await c.post(rec('scm', 'shipment'), { company: CO, branch: JED, data: sh }), 'late shipment'); must(await c.put(rec('scm', 'shipment') + '/' + s.id, { status: 'InTransit', data: sh }), 'in transit');
      const sm = must(await c.get(M('scm', 'summary')), 'scm summary'); ok(kp(sm, 'delayed') >= 1, 'delayed ' + kp(sm, 'delayed')); ok(kp(sm, 'inTransit') >= 1, 'inTransit ' + kp(sm, 'inTransit'));
      const x = must(await c.post(rec('scm', 'shipment'), { company: CO, branch: JED, data: { type: 'Outbound', ref: 'CXL-' + K } }), 'second'); const cx = must(await c.put(rec('scm', 'shipment') + '/' + x.id, { status: 'Cancelled', data: x.data }), 'cancel'); ok(cx.status === 'Cancelled', cx.status);
      must(await c.del(rec('scm', 'shipment') + '/' + x.id), 'delete'); ok(!(await list('scm', 'shipment')).some(y => y.id === x.id), 'deleted shipment listed');
      return 'delayed ' + kp(sm, 'delayed');
    });

    await u.step('P08-15', 'Demand forecast FG 100 + 120 + 140 = 360; month 1 demand 100 against stock 95 shows a shortfall of 5; cancelled month leaves the active total', async () => {
      const d0 = new Date(u.ws.today + 'T00:00:00Z'); const per = i => new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1 + i, 1)).toISOString().slice(0, 7);
      const made = [];
      for (const [i, q] of [[0, 100], [1, 120], [2, 140]]) made.push(must(await c.post(rec('scm', 'forecast'), { company: CO, data: { sku: FG, period: per(i), qty: q, method: 'Manual' } }), 'forecast ' + i));
      ok(made.every(f => f.status === 'Active' && /^FC-/.test(f.code)), 'forecast status/code');
      const fc = (await list('scm', 'forecast')).filter(f => f.data.sku === FG); eq(fc.length, 3, 'months'); eq(fc.reduce((a, f) => a + num(f.data.qty), 0), 360, 'total demand');
      const stock = (await stockMap())[FG]; eq(Math.max(0, 100 - stock), 5, 'month-1 shortfall');
      const sm = must(await c.get(M('scm', 'summary')), 'scm summary'); eq((rows(sm, 'forecast').find(x => x.name === FG) || {}).value, 360, 'forecast by product'); ok(kp(sm, 'forecastQty') >= 360, 'forecastQty ' + kp(sm, 'forecastQty'));
      const c3 = must(await c.put(rec('scm', 'forecast') + '/' + made[2].id, { status: 'Cancelled', data: made[2].data }), 'cancel month 3'); ok(c3.status === 'Cancelled', c3.status);
      ok(kp(must(await c.get(M('scm', 'summary')), 'again'), 'forecastQty') >= 220 - 0.005, 'active forecast');
      return 'total 360, shortfall 5';
    });

    await u.step('P08-16', 'SCM overview: carriers, on-time % between 0 and 100, shipments by status include Delivered and InTransit', async () => {
      const sm = must(await c.get(M('scm', 'summary')), 'scm summary');
      ok(kp(sm, 'carriers') >= 1, 'carriers'); const ot = kp(sm, 'onTimePct'); ok(ot >= 0 && ot <= 100, 'onTimePct ' + ot);
      const n = s => num((rows(sm, 'shipments').find(x => x.name === s) || {}).value); ok(n('Delivered') >= 1 && n('InTransit') >= 1, 'shipments by status');
      return `on time ${ot}%`;
    });

    await u.step('P08-17', 'Wrong module / kind refused: purchase orders are not a manufacturing kind, a BOM is not an SCM kind, unknown kind 404', async () => {
      refused(await c.get(rec('mfg', 'po')), 'po in mfg', [404]); refused(await c.get(rec('scm', 'bom')), 'bom in scm', [404]); refused(await c.get(rec('mfg', 'nothing')), 'unknown kind', [404]);
      refused(await c.post(M('scm', 'workorders/x/release')), 'work order action in scm', [404]);
      return 'ok';
    });
  },
};
