// Warehouse / stores keeper: locations and bins, items (POS products), stock in/out, transfer between branches, pick lists,
// cycle counts with variance, stock-not-enough refusals, warehouse stock endpoint, overview, inventory transfer document.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);

module.exports = {
  id: 'warehouse',
  title: 'Warehouse and stores keeper',
  modules: ['wh', 'inventory', 'items'],
  role: 'admin-stores',
  perms: ['wh.view', 'wh.pick.manage', 'wh.count.manage', 'wh.count.approve', 'wh.reports.view', 'wh.setup', 'pos.products.manage', 'pos.stock.manage', 'pos.stock.view', 'inventory.view', 'inventory.create'],
  probe: { path: '/api/erp/wh/records/pick', perm: 'wh.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company, JED = u.ws.branch.JED, DMM = u.ws.branch.DMM;
    const API = p => `/api/erp/wh/${p}`;
    const rec = k => API(`records/${k}`);
    const list = async (k, qs = '') => must(await c.get(rec(k) + '?take=5000' + qs), 'list ' + k);
    const X = `WHA-${K}`, Y = `WHB-${K}`, WH = `WH-${K}`, B1 = `BIN1-${K}`, B2 = `BIN2-${K}`;
    const stock = async (br = JED) => { const rows = must(await c.get(API(`wh-stock?branch=${br}`)), 'wh-stock ' + br); return { rows, q: s => rows.filter(r => r.sku === s).reduce((a, r) => a + num(r.qty), 0) }; };
    const adjust = (sku, delta, br = JED) => c.post('/api/pos/stock/adjust', { company: CO, branch: br, sku, delta, reason: 'wh ' + K });

    await u.step('P07-01', 'Settings and locations: warehouse with two bins, duplicate code refused, edit, delete a bin', async () => {
      const sets = await list('setting'); const d = sets.find(s => s.code === 'defaults');
      if (d) must(await c.put(rec('setting') + '/' + d.id, { status: 'Active', data: { ...d.data, allowNegativeStock: false } }), 'update defaults');
      else must(await c.post(rec('setting'), { code: 'defaults', company: CO, status: 'Active', data: { allowNegativeStock: false } }), 'create defaults');
      must(await c.post(rec('location'), { code: WH, company: CO, branch: JED, data: { name: 'Warehouse ' + K, type: 'Warehouse', parent: '' } }), 'create warehouse');
      for (const b of [B1, B2]) must(await c.post(rec('location'), { code: b, company: CO, branch: JED, data: { name: 'Bin ' + b, type: 'Bin', parent: WH } }), 'create bin ' + b);
      refused(await c.post(rec('location'), { code: WH, company: CO, branch: JED, data: { name: 'dup', type: 'Warehouse' } }), 'duplicate location', [409]);
      let locs = await list('location'); for (const code of [WH, B1, B2]) ok(locs.some(x => x.code === code), code + ' not listed');
      const w = locs.find(x => x.code === WH);
      const up = must(await c.put(rec('location') + '/' + w.id, { status: 'Active', data: { ...w.data, name: 'Main warehouse ' + K } }), 'rename'); eq(up.data.name === 'Main warehouse ' + K ? 1 : 0, 1, 'new name');
      const b2 = locs.find(x => x.code === B2); must(await c.del(rec('location') + '/' + b2.id), 'delete bin');
      locs = await list('location'); ok(!locs.some(x => x.code === B2), 'deleted bin still listed');
      return 'warehouse + bin A kept, bin B deleted';
    });

    await u.step('P07-02', 'Items (POS products): create two, duplicate refused, import by bulk, visible with cost in the warehouse item lookup', async () => {
      must(await c.post('/api/pos/records/product', { code: X, company: CO, status: 'Active', data: { name: 'Item A ' + K, unit: 'box', price: 20, cost: 10, trackStock: true, reorder: 30 } }), 'create X');
      refused(await c.post('/api/pos/records/product', { code: X, company: CO, status: 'Active', data: { name: 'dup', price: 1 } }), 'duplicate item', [409]);
      const imp = must(await c.post('/api/pos/records/product/bulk', [{ code: Y, company: CO, status: 'Active', data: { name: 'Item B ' + K, unit: 'pcs', price: 9, cost: 4, trackStock: true, reorder: 0 } }]), 'bulk import');
      eq(imp.created, 1, 'created by import');
      const items = must(await c.get(API('items')), 'item lookup');
      const ix = items.find(i => i.sku === X), iy = items.find(i => i.sku === Y); ok(ix && iy, 'items missing in lookup');
      eq(ix.cost, 10, 'X cost'); eq(iy.cost, 4, 'Y cost'); eq(ix.price, 20, 'X price'); ok(ix.stocked === true, 'X stocked');
      return 'items ' + X + ', ' + Y;
    });

    await u.step('P07-03', 'Stock in: +100 A and +50 B at Jeddah; value 1,000 / 200; unknown item and missing quantity refused', async () => {
      must(await adjust(X, 100), 'stock in A'); must(await adjust(Y, 50), 'stock in B');
      refused(await adjust('NOPE-' + K, 5), 'unknown item', [400]);
      refused(await c.post('/api/pos/stock/adjust', { company: CO, branch: JED, sku: X }), 'no quantity', [400]);
      const s = await stock(); eq(s.q(X), 100, 'A'); eq(s.q(Y), 50, 'B');
      const ra = s.rows.find(r => r.sku === X); eq(ra.value, 1000, 'A value'); eq(ra.cost, 10, 'A cost'); eq(ra.reorder, 30, 'A reorder'); ok(ra.name.includes(K), 'name on stock row');
      eq(s.rows.find(r => r.sku === Y).value, 200, 'B value');
      return 'A 100 (1,000.00), B 50 (200.00)';
    });

    await u.step('P07-04', 'Stock out: -20 A leaves 80', async () => {
      must(await adjust(X, -20), 'stock out'); eq((await stock()).q(X), 80, 'A after stock out');
      const mv = must(await c.get('/api/pos/records/stockmove?branch=' + JED), 'moves').filter(m => m.code === X);
      ok(mv.length >= 2, 'stock ledger lacks the moves'); return 'A 80';
    });

    await u.step('P07-05', 'Transfer 30 A Jeddah -> Dammam: leaves Jeddah at once (50), arrives on receive (30); invalid transfers refused', async () => {
      refused(await c.post('/api/pos/transfers', { company: CO, fromBranch: JED, toBranch: JED, lines: [{ sku: X, qty: 1 }] }), 'same branch', [400]);
      refused(await c.post('/api/pos/transfers', { company: CO, fromBranch: JED, toBranch: DMM, lines: [{ sku: X, qty: 5000 }] }), 'more than in stock', [400]);
      refused(await c.post('/api/pos/transfers', { company: CO, fromBranch: JED, toBranch: DMM, lines: [] }), 'no lines', [400]);
      const tr = must(await c.post('/api/pos/transfers', { company: CO, fromBranch: JED, toBranch: DMM, lines: [{ sku: X, qty: 30 }], note: 'move ' + K }), 'transfer');
      ok(tr.status === 'InTransit', tr.status); eq((await stock(JED)).q(X), 50, 'Jeddah after dispatch'); eq((await stock(DMM)).q(X), 0, 'Dammam before receive');
      const rc = must(await c.post(`/api/pos/transfers/${tr.id}/receive`), 'receive'); ok(rc.status === 'Received', rc.status);
      eq((await stock(DMM)).q(X), 30, 'Dammam after receive'); eq((await stock(JED)).q(X), 50, 'Jeddah unchanged');
      refused(await c.post(`/api/pos/transfers/${tr.id}/receive`), 'receive twice', [400]);
      return tr.code;
    });

    await u.step('P07-06', 'Pick list: Open -> confirm takes stock (A 50 -> 40); confirm twice refused; empty / pre-picked refused', async () => {
      refused(await c.post(rec('pick'), { company: CO, branch: JED, data: { reference: 'SO ' + K, lines: [] } }), 'pick without lines', [400]);
      refused(await c.post(rec('pick'), { company: CO, branch: JED, status: 'Picked', data: { reference: 'SO ' + K, lines: [{ sku: X, qty: 1, location: B1 }] } }), 'pick created as Picked', [400]);
      const pk = must(await c.post(rec('pick'), { company: CO, branch: JED, data: { reference: 'SO ' + K, due: u.ws.today, picker: u.username, lines: [{ sku: X, qty: 10, location: B1 }] } }), 'create pick');
      ok(pk.status === 'Open' && /^PK-/.test(pk.code), `pick ${pk.code} ${pk.status}`);
      const cf = must(await c.post(API(`picks/${pk.id}/confirm`)), 'confirm'); ok(cf.status === 'Picked', cf.status); ok(cf.data.pickedBy, 'pickedBy');
      eq((await stock()).q(X), 40, 'A after pick');
      refused(await c.post(API(`picks/${pk.id}/confirm`)), 'confirm twice', [400]);
      refused(await c.del(rec('pick') + '/' + pk.id), 'delete a picked list', [400]);
      refused(await c.put(rec('pick') + '/' + pk.id, { status: 'Open', data: cf.data }), 'reopen by hand', [400]);
      S.pick = pk; return pk.code + ' Picked, A 40';
    });

    await u.step('P07-07', 'Pick for more than in stock is refused and stays Open (stock untouched); an open pick can be deleted', async () => {
      const pk = must(await c.post(rec('pick'), { company: CO, branch: JED, data: { reference: 'BIG ' + K, lines: [{ sku: Y, qty: 500, location: B1 }] } }), 'create pick');
      const r = refused(await c.post(API(`picks/${pk.id}/confirm`)), 'not enough stock', [400]); ok(/not enough/i.test(r.text), 'message: ' + r.text);
      eq((await stock()).q(Y), 50, 'B untouched');
      ok((await list('pick')).find(x => x.id === pk.id).status === 'Open', 'pick should stay Open');
      must(await c.del(rec('pick') + '/' + pk.id), 'delete open pick'); ok(!(await list('pick')).some(x => x.id === pk.id), 'still listed');
      return 'refused: ' + r.text.slice(0, 60);
    });

    await u.step('P07-08', 'Cycle count A: system 40, counted 38 -> post: variance -2 = -20.00, stock 38; posting twice refused', async () => {
      refused(await c.post(rec('count'), { company: CO, branch: JED, data: { date: u.ws.today, lines: [] } }), 'count without lines', [400]);
      refused(await c.post(rec('count'), { company: CO, branch: JED, status: 'Posted', data: { date: u.ws.today, lines: [{ sku: X, counted: 1, system: 1 }] } }), 'count created as Posted', [400]);
      const ct = must(await c.post(rec('count'), { company: CO, branch: JED, data: { date: u.ws.today, lines: [{ sku: X, counted: 38, system: 40, location: B1 }] } }), 'create count');
      ok(ct.status === 'Draft' && /^CNT-/.test(ct.code), `count ${ct.code} ${ct.status}`);
      const p = must(await c.post(API(`counts/${ct.id}/post`)), 'post'); ok(p.status === 'Posted', p.status);
      eq(p.data.varianceQty, -2, 'variance qty'); eq(p.data.varianceValue, -20, 'variance value at cost'); eq(p.data.lines[0].system, 40, 'system qty read by the server');
      eq((await stock()).q(X), 38, 'A after count');
      refused(await c.post(API(`counts/${ct.id}/post`)), 'post twice', [400]);
      refused(await c.del(rec('count') + '/' + ct.id), 'delete posted count', [400]);
      return `${ct.code} variance -2 (-20.00)`;
    });

    await u.step('P07-09', 'Cycle count B up: system 50, counted 53 -> variance +3 = +12.00; a wrong "system" figure is ignored (server uses its own)', async () => {
      const ct = must(await c.post(rec('count'), { company: CO, branch: JED, data: { date: u.ws.today, lines: [{ sku: Y, counted: 53, system: 999, location: B1 }] } }), 'create count');
      const p = must(await c.post(API(`counts/${ct.id}/post`)), 'post'); eq(p.data.varianceQty, 3, 'qty'); eq(p.data.varianceValue, 12, 'value'); eq(p.data.lines[0].system, 50, 'system');
      eq((await stock()).q(Y), 53, 'B after count');
      const open = must(await c.post(rec('count'), { company: CO, branch: JED, data: { date: u.ws.today, lines: [{ sku: Y, counted: 53, system: 53 }] } }), 'second draft count'); ok(open.status === 'Draft', 'draft');
      must(await c.del(rec('count') + '/' + open.id), 'delete draft count');
      return 'B 53';
    });

    await u.step('P07-10', 'Warehouse stock endpoint: both branches, value = qty x cost (Jeddah A 380 + B 212 ; Dammam A 300)', async () => {
      const j = await stock(JED), d = await stock(DMM);
      eq(j.q(X), 38, 'JED A'); eq(j.q(Y), 53, 'JED B'); eq(d.q(X), 30, 'DMM A');
      eq(j.rows.find(r => r.sku === X).value, 380, 'JED A value'); eq(j.rows.find(r => r.sku === Y).value, 212, 'JED B value'); eq(d.rows.find(r => r.sku === X).value, 300, 'DMM A value');
      const all = must(await c.get(API('wh-stock')), 'all branches'); eq(all.filter(r => r.sku === X).reduce((a, r) => a + num(r.qty), 0), 68, 'A over all branches');
      return 'JED 592.00, DMM 300.00';
    });

    await u.step('P07-11', 'Overview: SKUs, stock value, low stock (A at Dammam 30 = reorder 30), open picks/counts, locations, value by branch', async () => {
      const sm = must(await c.get(API('summary')), 'wh summary');
      const kp = k => num(((sm.kpis || []).find(x => x.k === k) || {}).v); const rows = k => ((sm.lists || []).find(x => x.k === k) || { rows: [] }).rows;
      ok(kp('skus') >= 2, 'skus ' + kp('skus')); ok(kp('stockValue') >= 892 - 0.005, 'stockValue ' + kp('stockValue')); ok(kp('lowStock') >= 1, 'lowStock ' + kp('lowStock'));
      ok(kp('locations') >= 2, 'locations ' + kp('locations'));
      const vb = n => num((rows('valueByBranch').find(x => x.name === n) || {}).value || 0); ok(vb(JED) >= 592 - 0.005, 'value Jeddah ' + vb(JED)); ok(vb(DMM) >= 300 - 0.005, 'value Dammam ' + vb(DMM));
      ok(num((rows('picks').find(x => x.name === 'Picked') || {}).value || 0) >= 1, 'picks by status lacks Picked');
      return `skus ${kp('skus')}, value ${kp('stockValue')}, low ${kp('lowStock')}`;
    });

    await u.step('P07-12', 'Inventory document: Stock Transfer workflow started by me (inventory.create); unknown workflow refused', async () => {
      const defs = must(await c.get('/api/definitions'), 'definitions');
      const def = defs.find(d => /Stock Transfer/i.test(d.name) && /ERP/i.test(d.name)) || defs.find(d => /Stock Transfer/i.test(d.name)); ok(def, 'no Stock Transfer workflow template visible');
      const total = 30 * 10;
      const inst = must(await c.post('/api/instances/start', { definitionId: def.id, initialData: { docType: 'TRF', docNumber: 'TRF-' + K, module: 'inventory', company: CO, branch: JED, warehouse: WH, toWarehouse: 'DMM-' + K, docDate: u.ws.today,
        party: WH + ' -> DMM', currency: 'SAR', lines: [{ item: X, description: 'Item A ' + K, qty: 30, unit: 'box', unitPrice: 10, amount: total }], subtotal: total, total, requesterName: 'Keeper ' + K } }), 'start stock transfer document');
      eq(String(inst.startedBy).toLowerCase(), u.username.toLowerCase(), 'started by');
      const back = must(await c.get('/api/instances/' + inst.id), 'read document'); eq(back.id === inst.id ? 1 : 0, 1, 'document id');
      refused(await c.post('/api/instances/start', { definitionId: 'does-not-exist-' + K, initialData: {} }), 'unknown workflow', [404, 400]);
      return 'document ' + inst.id;
    });

    await u.step('P07-13', 'Invalid references refused: unknown kind, unknown pick / count id, stock record by hand; unknown branch has no stock', async () => {
      refused(await c.get(rec('nothing')), 'unknown kind', [404]);
      refused(await c.post(rec('stock'), { code: 'X', data: {} }), 'create a stock record by hand', [404]);
      refused(await c.post(API('picks/no-such-pick-' + K + '/confirm')), 'confirm unknown pick', [404]);
      refused(await c.post(API('counts/no-such-count-' + K + '/post')), 'post unknown count', [404]);
      const e = must(await c.get(API('wh-stock?branch=NOWHERE-' + K)), 'unknown branch'); eq(e.length, 0, 'rows for unknown branch');
      return 'ok';
    });
  },
};
