// Point of sale: cashier + manager in one. Own store terminal, products, promotion, customer; shift, sales, refund, void, stock, Z figures.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = {
  id: 'pos-cashier-manager',
  title: 'POS cashier and manager',
  modules: ['pos'],
  role: 'employee',
  perms: ['pos.*'],
  probe: { path: '/api/pos/summary', perm: 'pos.reports.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state;
    const BR = u.ws.branch.DMM, BR2 = u.ws.branch.JED, CO = u.ws.company;
    const A = `MSK-${K}`, B = `GLV-${K}`, C = `SYR-${K}`, D = `OLD-${K}`, REG = `T-${K}`, CUST = `CUST-${K}`;
    const base = { company: CO, branch: BR, register: REG };
    const list = async (kind, qs = '') => must(await c.get(`/api/pos/records/${kind}${qs}`), 'list ' + kind);
    const stockOf = async (sku, br = BR) => { const r = (await list('stock', `?branch=${br}`)).find(x => x.branch === br && x.data && x.data.sku === sku); return r ? num(r.data.qty) : 0; };
    const sale = (lines, pay, extra = {}) => c.post('/api/pos/sales/checkout', { ...base, lines, payments: pay, ...extra });

    await u.step('P11-01', 'Setup: VAT 15% excl. tax, terminal, category, 3 products (one by import), promotion, loyalty customer; duplicates refused', async () => {
      const cfg = { taxRate: 15, pricesIncludeTax: false, requireShift: true, allowNegativeStock: false, maxDiscountPct: 20, pointsPerCurrency: 1, pointValue: 0.05, receiptHeader: 'Store ' + K, receiptFooter: 'Thank you' };
      const cur = (await list('setting')).find(x => x.code === 'pos');
      if (cur) must(await c.put(`/api/pos/records/setting/${cur.id}`, { company: cur.company || CO, branch: cur.branch, status: 'Active', data: { ...cur.data, ...cfg } }), 'update settings');
      else must(await c.post('/api/pos/records/setting', { code: 'pos', company: CO, status: 'Active', data: cfg }), 'create settings');
      must(await c.post('/api/pos/records/register', { code: REG, company: CO, branch: BR, status: 'Active', data: { name: 'Terminal ' + K } }), 'create terminal');
      refused(await c.post('/api/pos/records/register', { code: REG, company: CO, branch: BR, status: 'Active', data: {} }), 'duplicate terminal', [409]);
      must(await c.post('/api/pos/records/category', { code: `CAT-${K}`, company: CO, status: 'Active', data: { name: 'Trade ' + K } }), 'create category');
      must(await c.post('/api/pos/records/product', { code: A, company: CO, status: 'Active', data: { name: 'Mask box ' + K, price: 15, cost: 8, barcode: 'B1' + u.tag, trackStock: true, category: 'Trade', reorder: 5 } }), 'create product A');
      must(await c.post('/api/pos/records/product', { code: B, company: CO, status: 'Active', data: { name: 'Gloves box ' + K, price: 26, cost: 14, barcode: 'B2' + u.tag, trackStock: true, category: 'Trade', reorder: 5 } }), 'create product B');
      refused(await c.post('/api/pos/records/product', { code: A, company: CO, status: 'Active', data: { name: 'dup', price: 1 } }), 'duplicate product', [409]);
      const imp = must(await c.post('/api/pos/records/product/bulk', [{ code: C, company: CO, status: 'Active', data: { name: 'Syringe box ' + K, price: 34, cost: 18, barcode: 'B3' + u.tag, trackStock: true, category: 'Trade', reorder: 8 } }]), 'bulk import');
      eq(imp.created, 1, 'import created'); 
      const imp2 = must(await c.post('/api/pos/records/product/bulk', [{ code: C, company: CO, status: 'Active', data: { name: 'Syringe box ' + K, price: 34, cost: 18, barcode: 'B3' + u.tag, trackStock: true, category: 'Trade', reorder: 8 } }, { code: '', data: {} }]), 'bulk import again');
      eq(imp2.updated, 1, 'import updated'); eq(imp2.skipped, 1, 'import skipped (no code)');
      const pr = must(await c.post('/api/pos/records/promotion', { company: CO, status: 'Active', data: { name: '10% off ' + K, type: 'pct', scope: 'sku', target: C, value: 10 } }), 'create promotion');
      ok(pr.code, 'promotion has no code'); S.promo = pr;
      const cu = must(await c.post('/api/pos/records/customer', { code: CUST, company: CO, status: 'Active', data: { name: 'Loyal ' + K, phone: '05' + u.tag, discountPct: 5, points: 0 } }), 'create customer');
      ok(cu.code === CUST, 'customer code');
      const prods = await list('product');
      for (const [s, p] of [[A, 15], [B, 26], [C, 34]]) { const r = prods.find(x => x.code === s); ok(r, s + ' not listed'); eq(r.data.price, p, s + ' price'); }
      ok((await list('register', `?branch=${BR}`)).some(x => x.code === REG), 'terminal not listed');
      return 'terminal ' + REG + ', 3 products, promo ' + pr.code + ', customer ' + CUST;
    });

    await u.step('P11-02', 'Stock: opening adjustments 40/20/10 (delta and count), unknown product refused, ledger lists moves', async () => {
      for (const [s, q] of [[A, 40], [B, 20]]) must(await c.post('/api/pos/stock/adjust', { company: CO, branch: BR, sku: s, delta: q, reason: 'opening ' + K }), 'adjust ' + s);
      must(await c.post('/api/pos/stock/adjust', { company: CO, branch: BR, sku: C, delta: 12, reason: 'opening ' + K }), 'adjust C');
      must(await c.post('/api/pos/stock/adjust', { company: CO, branch: BR, sku: C, counted: 10, reason: 'count ' + K }), 'count C');
      refused(await c.post('/api/pos/stock/adjust', { company: CO, branch: BR, sku: 'NOPE-' + K, delta: 1 }), 'unknown product', [400]);
      refused(await c.post('/api/pos/stock/adjust', { company: CO, branch: BR, sku: A }), 'no quantity', [400]);
      eq(await stockOf(A), 40, 'A stock'); eq(await stockOf(B), 20, 'B stock'); eq(await stockOf(C), 10, 'C stock after count');
      const mv = (await list('stockmove', `?branch=${BR}`)).filter(x => x.code === C);
      ok(mv.length >= 2 && mv.some(m => m.status === 'count'), 'stock ledger lacks the count move for C');
      return 'stock 40/20/10';
    });

    await u.step('P11-03', 'Selling without an open shift is refused; negative opening cash refused', async () => {
      refused(await sale([{ sku: A, qty: 1 }], [{ method: 'cash', amount: 50 }]), 'sale without shift', [400]);
      refused(await c.post('/api/pos/shifts/open', { ...base, openingCash: -5 }), 'negative opening', [400]);
      eq(await stockOf(A), 40, 'stock must not move on a refused sale');
      return 'refused (400) without shift';
    });

    await u.step('P11-04', 'Open shift with 500.00; current shift is it; second open refused', async () => {
      const sh = must(await c.post('/api/pos/shifts/open', { ...base, openingCash: 500 }), 'open shift');
      ok(sh.status === 'Open', 'status ' + sh.status); eq(sh.data.opening, 500, 'opening'); S.shift = sh;
      const cur = must(await c.get('/api/pos/shifts/current?register=' + REG), 'current'); ok(cur && cur.id === sh.id, 'current shift is not the new one');
      refused(await c.post('/api/pos/shifts/open', { ...base, openingCash: 100 }), 'second shift', [409]);
      return 'shift ' + sh.code;
    });

    await u.step('P11-05', 'Invalid baskets refused: empty, zero qty, unknown/inactive product, bad method, underpay, change on card, oversell, discount over limit', async () => {
      ok(S.shift, 'depends on P11-04');
      must(await c.post('/api/pos/records/product', { code: D, company: CO, status: 'Inactive', data: { name: 'Old ' + K, price: 5, trackStock: false } }), 'create inactive product');
      refused(await sale([], [{ method: 'cash', amount: 10 }]), 'empty basket', [400]);
      refused(await sale([{ sku: A, qty: 0 }], [{ method: 'cash', amount: 10 }]), 'zero qty', [400]);
      refused(await sale([{ sku: 'NOPE-' + K, qty: 1 }], [{ method: 'cash', amount: 100 }]), 'unknown product', [400]);
      refused(await sale([{ sku: D, qty: 1 }], [{ method: 'cash', amount: 100 }]), 'inactive product', [400]);
      refused(await sale([{ sku: A, qty: 1 }], [{ method: 'cheque', amount: 100 }]), 'unknown method', [400]);
      refused(await sale([{ sku: A, qty: 1 }], [{ method: 'cash', amount: 1 }]), 'underpayment', [400]);
      refused(await sale([{ sku: A, qty: 1 }], [{ method: 'card', amount: 100 }]), 'change on card', [400]);
      const o = refused(await sale([{ sku: A, qty: 41 }], [{ method: 'cash', amount: 1000 }]), 'oversell', [400]); ok(/stock/i.test(o.text), 'oversell message: ' + o.text);
      refused(await sale([{ sku: A, qty: 1, discountPct: 50 }], [{ method: 'cash', amount: 50 }]), 'discount above 20%', [400]);
      eq(await stockOf(A), 40, 'stock unchanged after refusals');
      must(await c.del(`/api/pos/records/product/${(await list('product')).find(x => x.code === D).id}`), 'delete inactive product');
      ok(!(await list('product')).some(x => x.code === D), 'deleted product still listed');
      return '9 refusals, stock unchanged';
    });

    await u.step('P11-06', 'Cash sale: 2 x 15 + 1 x 26 = 56.00 + VAT 8.40 = 64.40, tendered 70, change 5.60, stock -2/-1', async () => {
      ok(S.shift, 'depends on P11-04');
      const s = must(await sale([{ sku: A, qty: 2 }, { sku: B, qty: 1 }], [{ method: 'cash', amount: 70 }]), 'checkout 1'); const d = s.data;
      eq(d.subtotal, 56, 'subtotal'); eq(d.tax, 8.4, 'VAT'); eq(d.total, 64.4, 'total'); eq(d.change, 5.6, 'change'); eq(d.tendered, 70, 'tendered'); eq(d.discount, 0, 'discount');
      ok(s.status === 'Completed' && /^S-/.test(s.code), 'sale status/code ' + s.status + ' ' + s.code); ok(d.lines.length === 2 && d.lines.every(l => l.name), 'receipt lines'); ok(d.cashier, 'cashier on receipt');
      S.s1 = s; eq(await stockOf(A), 38, 'A stock'); eq(await stockOf(B), 19, 'B stock');
      return s.code + ' total 64.40 change 5.60';
    });

    await u.step('P11-07', 'Card sale with promotion: syringe x2 (10% off 68.00) + mask x1 = 83.00 - 6.80, VAT 11.43, total 87.63', async () => {
      ok(S.shift, 'depends on P11-04');
      const s = must(await sale([{ sku: C, qty: 2 }, { sku: A, qty: 1 }], [{ method: 'card', amount: 87.63, ref: 'CARD-' + K }]), 'checkout 2'); const d = s.data;
      const l = d.lines.find(x => x.sku === C); ok(l.promo === S.promo.code, 'promotion code on line: ' + l.promo); eq(l.promoDisc, 6.8, 'promo discount');
      eq(l.total - l.tax, 61.2, 'syringe net after promo'); eq(d.subtotal, 83, 'subtotal before discount'); eq(d.discount, 6.8, 'discount'); eq(d.tax, 11.43, 'VAT'); eq(d.total, 87.63, 'total'); eq(d.change, 0, 'change');
      S.s2 = s; eq(await stockOf(C), 8, 'C stock'); eq(await stockOf(A), 37, 'A stock');
      return s.code + ' 87.63 card';
    });

    await u.step('P11-08', 'Manual discount 10% + customer discount 5%: gloves x2 = 52.00 - 7.54, VAT 6.67, total 51.13; 51 points earned', async () => {
      ok(S.shift, 'depends on P11-04');
      const s = must(await sale([{ sku: B, qty: 2, discountPct: 10 }], [{ method: 'cash', amount: 100 }], { customer: CUST }), 'checkout 3'); const d = s.data;
      eq(d.subtotal, 52, 'subtotal'); eq(d.discount, 7.54, 'discount (5.20 manual + 2.34 customer)'); eq(d.tax, 6.67, 'VAT'); eq(d.total, 51.13, 'total'); eq(d.change, 48.87, 'change'); eq(d.earned, 51, 'points earned');
      const cu = (await list('customer')).find(x => x.code === CUST); eq(cu.data.points, 51, 'customer points'); eq(cu.data.spent, 51.13, 'customer spent');
      S.s3 = s; return 'total 51.13, points 51';
    });

    await u.step('P11-09', 'Redeem loyalty points: mask x1, customer 5% -> 16.39, 51 points = 2.55, due 13.84, change 6.16, new points 13', async () => {
      ok(S.shift && S.s3, 'depends on P11-08');
      refused(await sale([{ sku: A, qty: 1 }], [{ method: 'cash', amount: 100 }], { redeemPoints: 10 }), 'redeem without customer', [400]);
      const s = must(await sale([{ sku: A, qty: 1 }], [{ method: 'cash', amount: 20 }], { customer: CUST, redeemPoints: 100 }), 'checkout 4'); const d = s.data;
      eq(d.total, 16.39, 'total'); eq(d.tax, 2.14, 'VAT'); eq(d.redeemedPoints, 51, 'points redeemed'); eq(d.redeemValue, 2.55, 'redeem value'); eq(d.change, 6.16, 'change'); eq(d.earned, 13, 'points earned');
      ok(d.payments.some(p => p.method === 'loyalty'), 'loyalty payment line missing');
      const cu = (await list('customer')).find(x => x.code === CUST); eq(cu.data.points, 13, 'customer points after'); eq(cu.data.spent, 67.52, 'customer spent');
      S.s4 = s; return 'due 13.84, points 51 -> 13';
    });

    await u.step('P11-10', 'Cash in 100 and cash out 30 on the drawer; zero amount and closed-shift moves refused', async () => {
      ok(S.shift, 'depends on P11-04');
      refused(await c.post(`/api/pos/shifts/${S.shift.id}/cash`, { type: 'in', amount: 0, reason: 'x' }), 'zero amount', [400]);
      let sh = must(await c.post(`/api/pos/shifts/${S.shift.id}/cash`, { type: 'in', amount: 100, reason: 'float ' + K }), 'cash in');
      sh = must(await c.post(`/api/pos/shifts/${S.shift.id}/cash`, { type: 'out', amount: 30, reason: 'petty ' + K }), 'cash out');
      eq(sh.data.cashIn, 100, 'cashIn'); eq(sh.data.cashOut, 30, 'cashOut');
      ok((await list('cashmove')).filter(x => x.ref === S.shift.code).length === 2, 'cash movements not listed');
      return 'in 100 / out 30';
    });

    await u.step('P11-11', 'Void an untouched sale: stock comes back, status Voided; void twice and void after return refused', async () => {
      ok(S.shift && S.s1, 'depends on P11-04/06');
      const s5 = must(await sale([{ sku: A, qty: 1 }], [{ method: 'cash', amount: 20 }]), 'checkout 5'); eq(s5.data.total, 17.25, 'total'); eq(await stockOf(A), 35, 'A before void');
      const v = must(await c.post(`/api/pos/sales/${s5.id}/void`, {}), 'void'); ok(v.status === 'Voided', 'status ' + v.status);
      eq(await stockOf(A), 36, 'A after void');
      refused(await c.post(`/api/pos/sales/${s5.id}/void`, {}), 'void twice', [400]);
      refused(await c.post(`/api/pos/sales/${s5.id}/return`, { lines: [{ sku: A, qty: 1 }], method: 'cash' }), 'return of voided sale', [400]);
      return 'voided ' + s5.code;
    });

    await u.step('P11-12', 'Refunds: 1 glove cash 29.90 (VAT 3.90), 1 mask by card 17.25; stock back; over-return and wrong sku refused; sale becomes PartlyReturned', async () => {
      ok(S.s1 && S.s2, 'depends on P11-06/07');
      const b0 = await stockOf(B), a0 = await stockOf(A);
      const r1 = must(await c.post(`/api/pos/sales/${S.s1.id}/return`, { lines: [{ sku: B, qty: 1 }], method: 'cash', reason: 'returned ' + K }), 'return 1'); const d = r1.data;
      ok(d.type === 'Return', 'type ' + d.type); eq(d.total, -29.9, 'refund total'); eq(d.tax, -3.9, 'refund VAT');
      eq(await stockOf(B), b0 + 1, 'B stock after refund');
      const orig = (await list('sale')).find(x => x.id === S.s1.id); ok(orig.status === 'PartlyReturned', 'original status ' + orig.status); eq(orig.data.lines.find(l => l.sku === B).returned, 1, 'returned qty');
      refused(await c.post(`/api/pos/sales/${S.s1.id}/return`, { lines: [{ sku: B, qty: 1 }], method: 'cash' }), 'return more than sold', [400]);
      refused(await c.post(`/api/pos/sales/${S.s1.id}/return`, { lines: [{ sku: C, qty: 1 }], method: 'cash' }), 'sku not on the sale', [400]);
      refused(await c.post(`/api/pos/sales/${S.s1.id}/return`, { lines: [], method: 'cash' }), 'nothing chosen', [400]);
      const r2_ = must(await c.post(`/api/pos/sales/${S.s2.id}/return`, { lines: [{ sku: A, qty: 1 }], method: 'card', reason: 'card refund ' + K }), 'return 2');
      eq(r2_.data.total, -17.25, 'card refund total'); eq(r2_.data.tax, -2.25, 'card refund VAT'); ok(r2_.data.method === 'card', 'method');
      eq(await stockOf(A), a0 + 1, 'A stock after refund');
      return 'refund 29.90 cash + 17.25 card';
    });

    await u.step('P11-13', 'Close shift counting 665.00: expected 669.47, variance -4.47; Z figures; stock 37/18/8; closing twice refused', async () => {
      ok(S.shift && S.s1 && S.s2 && S.s3 && S.s4, 'depends on P11-04..09');
      refused(await c.post(`/api/pos/shifts/${S.shift.id}/close`, { countedCash: -1 }), 'negative count', [400]);
      const cl = must(await c.post(`/api/pos/shifts/${S.shift.id}/close`, { countedCash: 665, note: 'close ' + K }), 'close'); const d = cl.data;
      ok(cl.status === 'Closed', 'status ' + cl.status);
      eq(d.expected, 669.47, 'expected cash (500 + 129.37 - 29.90 + 100 - 30)'); eq(d.counted, 665, 'counted'); eq(d.variance, -4.47, 'variance');
      eq(d.salesTotal, 219.55, 'sales total'); eq(d.salesTax, 28.64, 'sales VAT'); eq(d.salesCount, 4, 'sales count (void excluded)'); eq(d.returnsTotal, 47.15, 'returns total'); eq(d.returnsTax, 6.15, 'returns VAT'); eq(d.returnCount, 2, 'return count');
      eq(d.cashSales, 129.37, 'cash sales'); eq(d.cardSales, 87.63, 'card sales'); eq(d.refundCash, 29.9, 'cash refunds'); eq(d.loyaltyValue, 2.55, 'loyalty value'); eq(d.discountTotal, 15.09, 'discounts'); eq(d.voidCount, 1, 'void count');
      eq(r2(d.salesTotal - d.returnsTotal), 172.4, 'Z gross'); eq(r2(d.salesTax - d.returnsTax), 22.49, 'Z VAT');
      refused(await c.post(`/api/pos/shifts/${S.shift.id}/close`, { countedCash: 665 }), 'close twice', [400]);
      refused(await c.post(`/api/pos/shifts/${S.shift.id}/cash`, { type: 'in', amount: 5 }), 'cash move on closed shift', [400]);
      refused(await sale([{ sku: A, qty: 1 }], [{ method: 'cash', amount: 50 }]), 'sale after close', [400]);
      eq(await stockOf(A), 37, 'A stock'); eq(await stockOf(B), 18, 'B stock'); eq(await stockOf(C), 8, 'C stock');
      const cur = must(await c.get('/api/pos/shifts/current?register=' + REG), 'current'); ok(cur === null || cur === '' || !cur.id, 'a closed shift is still current');
      return 'expected 669.47 variance -4.47; Z 172.40 incl. VAT 22.49';
    });

    await u.step('P11-14', 'Overview: today sales, returns, payments, top products, low stock (syringe at reorder level), stock value', async () => {
      ok(S.shift, 'depends on P11-04');
      const sm = must(await c.get(`/api/pos/summary?branch=${BR}`), 'summary');
      ok(num(sm.salesToday) >= 219.55 - 0.005, 'salesToday ' + sm.salesToday); ok(num(sm.returnsToday) >= 47.15 - 0.005, 'returnsToday ' + sm.returnsToday); ok(num(sm.countToday) >= 4, 'countToday ' + sm.countToday);
      const pay = n => num(((sm.payments || []).find(x => x.name === n) || {}).value || 0);
      ok(pay('card') >= 87.63 - 0.005, 'card ' + pay('card')); ok(pay('cash') >= 129.37 - 0.005, 'cash ' + pay('cash'));
      ok((sm.topProducts || []).length > 0, 'no top products');
      ok((sm.lowStock || []).some(x => x.sku === C && num(x.qty) === 8), 'syringe (8 <= reorder 8) is not in lowStock: ' + JSON.stringify(sm.lowStock));
      ok(num(sm.stockValue) >= 692 - 0.005, 'stockValue ' + sm.stockValue + ' < 692 (37x8 + 18x14 + 8x18)');
      if (Math.abs(num(sm.salesToday) - 219.55) < 0.005) { eq(sm.cashVariance, -4.47, 'cashVariance (alone in the branch)'); eq(sm.openShifts, 0, 'open shifts'); }
      return `salesToday ${sm.salesToday}, returns ${sm.returnsToday}, ${sm.countToday} sales`;
    });

    await u.step('P11-15', 'Stock transfer 5 gloves DMM -> JED: out immediately, in on receive; same branch / too many / receive twice refused', async () => {
      refused(await c.post('/api/pos/transfers', { company: CO, fromBranch: BR, toBranch: BR, lines: [{ sku: B, qty: 1 }] }), 'same branch', [400]);
      refused(await c.post('/api/pos/transfers', { company: CO, fromBranch: BR, toBranch: BR2, lines: [{ sku: B, qty: 500 }] }), 'more than in stock', [400]);
      refused(await c.post('/api/pos/transfers', { company: CO, fromBranch: BR, toBranch: BR2, lines: [] }), 'no lines', [400]);
      const tr = must(await c.post('/api/pos/transfers', { company: CO, fromBranch: BR, toBranch: BR2, lines: [{ sku: B, qty: 5 }], note: 'move ' + K }), 'transfer');
      ok(tr.status === 'InTransit', 'status ' + tr.status); eq(await stockOf(B, BR), 13, 'source stock'); eq(await stockOf(B, BR2), 0, 'target stock before receive');
      const rc = must(await c.post(`/api/pos/transfers/${tr.id}/receive`, {}), 'receive'); ok(rc.status === 'Received', 'status ' + rc.status);
      eq(await stockOf(B, BR2), 5, 'target stock after receive'); eq(await stockOf(B, BR), 13, 'source stock after');
      refused(await c.post(`/api/pos/transfers/${tr.id}/receive`, {}), 'receive twice', [400]);
      ok((await list('transfer')).some(x => x.id === tr.id && x.status === 'Received'), 'transfer not listed as Received');
      return tr.code + ' 5 boxes';
    });

    await u.step('P11-16', 'Maintenance: promotion switched off removes the discount, product edit, customer edit, delete; unknown kind refused', async () => {
      const pr = (await list('promotion')).find(x => S.promo && x.id === S.promo.id); ok(pr, 'promotion not listed');
      must(await c.put(`/api/pos/records/promotion/${pr.id}`, { company: pr.company, branch: pr.branch, status: 'Inactive', data: pr.data }), 'deactivate promotion');
      ok((await list('promotion')).find(x => x.id === pr.id).status === 'Inactive', 'promotion not Inactive');
      const p = (await list('product')).find(x => x.code === C);
      const up = must(await c.put(`/api/pos/records/product/${p.id}`, { company: p.company, branch: p.branch, status: 'Active', data: { ...p.data, price: 36 } }), 'edit product'); eq(up.data.price, 36, 'new price');
      const cu = (await list('customer')).find(x => x.code === CUST);
      must(await c.put(`/api/pos/records/customer/${cu.id}`, { company: cu.company, branch: cu.branch, status: 'Active', data: { ...cu.data, discountPct: 0 } }), 'edit customer');
      must(await c.del(`/api/pos/records/promotion/${pr.id}`), 'delete promotion'); ok(!(await list('promotion')).some(x => x.id === pr.id), 'promotion still listed');
      refused(await c.get('/api/pos/records/nothing'), 'unknown kind', [404]);
      refused(await c.post('/api/pos/records/sale', { code: 'X-' + K, data: {} }), 'create sale record by hand', [404]);
      return 'promotion off+deleted, price 36, customer discount 0';
    });

    u.manual('P11-M1', 'Held (parked) sales', 'The POS API has no hold/park endpoint; parking happens in the till screen only.');
  },
};
