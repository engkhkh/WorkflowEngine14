// Finance - accounts payable: supplier, bills with VAT, duplicate control, 3-way match (tolerance, mismatch, override), hold/reject/delete rules, payment, aging, GL tie-out.
const { refused } = require('../lib');
const { must, eq, ok, toNum, r2, addDays, ACC, invTotal, flist, fcreate, fput, fputOk, byId, journal, net, ageBucket, bankAccount, bankBalance } = require('./_fin');

module.exports = {
  id: 'finance-ap',
  title: 'Payables clerk',
  modules: ['finance'],
  role: 'finance',
  perms: ['finance.*', 'cal.*'],
  probe: { path: '/api/finance/records/apinvoice', perm: 'finance.ap.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company, today = u.ws.today;
    const VND = `VND-${K}`, BANK = `BKP-${K}`, PO = `PO-${K}`;
    S.codes = new Set(); S.b = {};

    const bill = (no, netAmt, over = {}) => {
      const tax = r2(netAmt * 0.15), total = r2(netAmt + tax);
      return c.post('/api/finance/records/apinvoice', { company: CO, status: 'Submitted', data: Object.assign({ vendor: VND, invoiceNo: no, date: today, dueDate: addDays(today, 30), currency: 'SAR', rate: 1, amount: netAmt, taxCode: 'VAT15-IN', taxAmount: tax, total,
        account: ACC.inv, costCenter: '', notes: 'Bill ' + K, paid: 0, glJournal: '', poNo: '', poAmount: 0, receivedAmount: 0, matchOverride: false }, over) });
    };
    /** Approve and book in the GL like the screen: Dr inventory, Dr VAT input, Cr payables. */
    const approveAndPost = async rec => {
      const ap = await fputOk(c, 'apinvoice', rec, { status: 'Approved' }, 'approve ' + rec.data.invoiceNo);
      const total = invTotal(ap.data), tax = toNum(ap.data.taxAmount);
      const j = await journal(c, CO, { date: String(ap.data.date).slice(0, 10), memo: `${VND} - ${ap.data.invoiceNo}`, reference: ap.code, lines: [
        { account: ACC.inv, debit: r2(total - tax) }, { account: ACC.vatIn, debit: tax }, { account: ACC.ap, credit: total }] });
      const done = await fputOk(c, 'apinvoice', ap, { data: { glJournal: j.code } }, 'link journal');
      S.codes.add(done.code); return done;
    };

    await u.step('AP-01', 'Supplier master: create with terms, duplicate / missing code refused, update, visible in lookups', async () => {
      S.vnd = await fcreate(c, 'vendor', { code: VND, status: 'Active', data: { name: 'Supplier ' + K, nameAr: 'مورد ' + K, email: `${VND.toLowerCase()}@example.com`, termsDays: 45, city: 'Dammam' } });
      refused(await c.post('/api/finance/records/vendor', { code: VND, status: 'Active', data: { name: 'dup' } }), 'duplicate supplier', [409]);
      refused(await c.post('/api/finance/records/vendor', { status: 'Active', data: { name: 'no code' } }), 'supplier without code', [400]);
      const up = await fputOk(c, 'vendor', S.vnd, { data: { termsDays: 30 } }); eq(up.data.termsDays, 30, 'terms');
      const lk = must(await c.get('/api/erp/proc/lookups/vendors'), 'vendor lookup'); ok(lk.some(x => x.code === VND), 'supplier not in lookups');
      await bankAccount(c, CO, BANK, 'Payments ' + K, 5000);
      return VND + ' terms 30 days';
    });

    await u.step('AP-02', 'Bill 1 (no PO): net 2,000.00 + VAT 300.00 = 2,300.00; Submitted counts for approval, Approved with approver, GL Dr 1200 / Dr 1150 / Cr 2100', async () => {
      const r = must(await bill('INV-A-' + K, 2000), 'create bill');
      ok(/^AP-\d{4}-\d{4}$/.test(r.code), 'bill number ' + r.code); eq(r.status, 'Submitted', 'status'); eq(r.data.matchStatus, 'NoPO', 'match status'); eq(r.data.total, 2300, 'total'); eq(r.data.taxAmount, 300, 'VAT');
      const s = must(await c.get('/api/finance/summary'), 'summary'); ok(s.invoicesToApprove >= 1, 'invoicesToApprove ' + s.invoicesToApprove);
      const d = await approveAndPost(r); S.b.one = d;
      eq(d.status, 'Approved', 'approved'); ok(String(d.approvedBy).toLowerCase() === u.username.toLowerCase(), 'approvedBy ' + d.approvedBy); ok(d.data.glJournal, 'journal linked');
      const jv = (await flist(c, 'journal')).find(j => j.code === d.data.glJournal);
      eq(net([jv]).of(ACC.inv), 2000, 'Dr inventory'); eq(net([jv]).of(ACC.vatIn), 300, 'Dr VAT input'); eq(net([jv]).of(ACC.ap), -2300, 'Cr payables');
      return d.code + ' 2,300.00, journal ' + jv.code;
    });

    await u.step('AP-03', 'Duplicate supplier invoice number refused (also with different letter case); the first bill is unchanged', async () => {
      ok(S.b.one, 'depends on AP-02');
      refused(await bill('INV-A-' + K, 50), 'duplicate invoice number', [400]);
      refused(await bill(('INV-A-' + K).toLowerCase(), 50), 'duplicate invoice number (lower case)', [400]);
      eq((await flist(c, 'apinvoice')).filter(b => b.data.vendor === VND && String(b.data.invoiceNo).toUpperCase() === ('INV-A-' + K).toUpperCase()).length, 1, 'only one bill with that number');
      return 'both duplicates refused (400)';
    });

    await u.step('AP-04', 'Three-way match: bill 1,150.00 and 1,172.00 against ordered 2,000 / received 1,150 (2% tolerance, limit 1,173.00) are Matched and can be approved', async () => {
      const po = { poNo: PO, poAmount: 2000, receivedAmount: 1150 };
      const a = must(await bill('INV-B-' + K, 1000, po), 'bill 2'); eq(a.data.matchStatus, 'Matched', 'bill 2 match'); eq(a.data.total, 1150, 'bill 2 total');
      S.b.two = await approveAndPost(a); eq(S.b.two.status, 'Approved', 'approved');
      const b = must(await bill('INV-C-' + K, 1019.13, Object.assign({ taxAmount: 152.87, total: 1172 }, po)), 'bill 3');
      eq(b.data.total, 1172, 'bill 3 total'); eq(b.data.matchStatus, 'Matched', 'bill 3 inside tolerance');
      S.b.three = await approveAndPost(b); eq(S.b.three.status, 'Approved', 'approved');
      return 'both Matched and approved';
    });

    await u.step('AP-05', 'Mismatch: bill 1,200.00 over the received 1,150.00 is flagged and cannot be approved; override allows it; nothing received is a mismatch too', async () => {
      const po = { poNo: PO, poAmount: 2000, receivedAmount: 1150 };
      const bad = must(await bill('INV-D-' + K, 1043.48, Object.assign({ taxAmount: 156.52, total: 1200 }, po)), 'bill 4');
      eq(bad.data.matchStatus, 'Mismatch', 'match status');
      const r = refused(await fput(c, 'apinvoice', bad, { status: 'Approved' }), 'approve mismatched bill', [400]);
      ok(/match/i.test(r.text), 'message should mention the match: ' + r.text.slice(0, 100));
      eq((await byId(c, 'apinvoice', bad.id)).status, 'Submitted', 'still Submitted');
      const none = must(await bill('INV-E-' + K, 100, { poNo: PO, poAmount: 500, receivedAmount: 0 }), 'bill nothing received');
      eq(none.data.matchStatus, 'Mismatch', 'nothing received');
      refused(await fput(c, 'apinvoice', none, { status: 'Approved' }), 'approve with nothing received', [400]);
      const rj = await fputOk(c, 'apinvoice', none, { status: 'Rejected' }, 'reject test bill');
      must(await c.del(`/api/finance/records/apinvoice/${rj.id}`), 'delete rejected test bill');
      return 'refused';
    });

    await u.step('AP-06', 'Override the match: bill 4 (1,200.00) approved with matchOverride, still shown as Mismatch', async () => {
      const bad = (await flist(c, 'apinvoice')).find(b => b.data.vendor === VND && b.data.invoiceNo === 'INV-D-' + K);
      ok(bad, 'depends on AP-05');
      const ov = await fputOk(c, 'apinvoice', bad, { data: { matchOverride: true } }, 'tick override');
      S.b.four = await approveAndPost(ov);
      eq(S.b.four.status, 'Approved', 'approved by override'); eq(S.b.four.data.matchStatus, 'Mismatch', 'match status stays Mismatch');
      return 'override approved ' + S.b.four.code;
    });

    await u.step('AP-07', 'Hold, reject and delete rules: Held and Rejected bills can be deleted, an Approved bill cannot', async () => {
      const h = must(await bill('INV-H-' + K, 10), 'bill to hold');
      const held = await fputOk(c, 'apinvoice', h, { status: 'Held' }, 'hold'); eq(held.status, 'Held', 'held');
      const s = must(await c.get('/api/finance/summary'), 'summary'); ok(s.apOutstanding >= 11.5, 'Held bills count as payable');
      must(await c.del(`/api/finance/records/apinvoice/${held.id}`), 'delete held');
      const r = must(await bill('INV-R-' + K, 10), 'bill to reject');
      const rej = await fputOk(c, 'apinvoice', r, { status: 'Rejected' }, 'reject'); eq(rej.status, 'Rejected', 'rejected');
      must(await c.del(`/api/finance/records/apinvoice/${rej.id}`), 'delete rejected');
      ok(S.b.two, 'depends on AP-04'); refused(await c.del(`/api/finance/records/apinvoice/${S.b.two.id}`), 'delete approved bill', [400]);
      return 'held + rejected deleted, approved refused';
    });

    await u.step('AP-08', 'Pay bill 1: only an Approved bill can be paid (Submitted refused), paid 2,300.00, bank 5,000 -> 2,700.00, GL Dr 2100 / Cr 1020, paid bill locked', async () => {
      ok(S.b.one, 'depends on AP-02');
      const sub = must(await bill('INV-S-' + K, 100), 'submitted bill');
      refused(await fput(c, 'apinvoice', sub, { status: 'Paid', data: { paid: 115 } }), 'pay a Submitted bill', [400]);
      const rj = await fputOk(c, 'apinvoice', sub, { status: 'Rejected' }, 'reject test bill');
      must(await c.del(`/api/finance/records/apinvoice/${rj.id}`), 'delete test bill');
      const paid = await fputOk(c, 'apinvoice', S.b.one, { status: 'Paid', data: { paid: 2300, paidDate: today, bankAccount: BANK } }, 'pay');
      eq(paid.status, 'Paid', 'status'); eq(paid.data.paid, 2300, 'paid');
      await fcreate(c, 'banktxn', { company: CO, status: 'Active', data: { account: BANK, date: today, amount: -2300, description: 'Payment ' + paid.code, reference: paid.code, reconciled: false } });
      await journal(c, CO, { date: today, memo: 'Payment ' + paid.code, reference: paid.code, lines: [{ account: ACC.ap, debit: 2300 }, { account: ACC.bank, credit: 2300 }] });
      S.codes.add(paid.code);
      const bank = (await flist(c, 'bankaccount')).find(b => b.code === BANK); eq(await bankBalance(c, bank), 2700, 'bank balance');
      refused(await fput(c, 'apinvoice', paid, { data: { notes: 'tamper' } }), 'edit paid bill', [400]);
      refused(await c.del(`/api/finance/records/apinvoice/${paid.id}`), 'delete paid bill', [400]);
      S.b.one = paid;
      return 'paid; bank 2,700.00';
    });

    await u.step('AP-09', 'Overdue bill 1,150.00 (due 45 days ago) falls in the 31-60 bucket; CFO aging, overdue and approval counts include it', async () => {
      const due = addDays(today, -45);
      const r = must(await bill('INV-O-' + K, 1000, { date: addDays(today, -50), dueDate: due }), 'overdue bill');
      S.b.old = await approveAndPost(r);
      eq(ageBucket(due, today), 2, 'bucket'); eq(S.b.old.data.total, 1150, 'total');
      const s = must(await c.get('/api/finance/summary'), 'summary');
      ok(s.apOverdue >= 1150, 'apOverdue ' + s.apOverdue); ok(s.apAging[2].value >= 1150, '31-60 ' + s.apAging[2].value);
      ok(s.apOutstanding >= 4672, 'apOutstanding ' + s.apOutstanding); eq(s.apAging.length, 5, 'buckets');
      ok(Array.isArray(s.apDue), 'apDue list');
      return 'workspace AP ' + s.apOutstanding + ', overdue ' + s.apOverdue;
    });

    await u.step('AP-10', 'Supplier statement: billed 6,972.00 - paid 2,300.00 = open 4,672.00 = sum of the four unpaid bills', async () => {
      const bs = (await flist(c, 'apinvoice')).filter(b => b.data.vendor === VND && ['Approved', 'Paid'].includes(b.status));
      eq(bs.length, 5, 'approved / paid bills');
      const billed = r2(bs.reduce((s, b) => s + invTotal(b.data), 0)), paid = r2(bs.reduce((s, b) => s + toNum(b.data.paid), 0));
      eq(billed, 6972, 'billed'); eq(paid, 2300, 'paid'); eq(r2(billed - paid), 4672, 'open');
      const open = bs.filter(b => b.status === 'Approved').reduce((s, b) => s + invTotal(b.data) - toNum(b.data.paid), 0);
      eq(r2(open), 4672, 'open of Approved bills');
      return 'open 4,672.00';
    });

    await u.step('AP-11', 'GL tie-out: payables 4,672.00 credit, inventory 6,062.61, VAT input 909.39, bank paid 2,300.00 over my bill journals', async () => {
      const mine = (await flist(c, 'journal', '?status=Posted')).filter(j => S.codes.has(String(j.data.reference)));
      const t = net(mine);
      eq(t.of(ACC.ap), -4672, 'payables per GL'); eq(t.of(ACC.inv), 6062.61, 'inventory'); eq(t.of(ACC.vatIn), 909.39, 'VAT input'); eq(t.of(ACC.bank), -2300, 'bank');
      eq(t.dr, t.cr, 'balanced');
      return `${mine.length} journals`;
    });

    await u.step('AP-12', 'Audit trail of bill 4: created, approved by me; bill missing the supplier/amount is still stored as Draft (screen-level rule) and deletable', async () => {
      ok(S.b.four, 'depends on AP-06');
      const au = must(await c.get(`/api/finance/audit?recordId=${S.b.four.id}`), 'audit');
      ok(au.some(a => a.action === 'Created'), 'Created'); ok(au.some(a => a.action === 'StatusChanged' && /Approved/.test(a.summary || '')), 'approval row');
      ok(au.every(a => String(a.userName).toLowerCase() === u.username.toLowerCase()), 'acting user');
      const d = must(await c.post('/api/finance/records/apinvoice', { company: CO, status: 'Draft', data: { vendor: VND, invoiceNo: 'INV-DR-' + K, amount: 10, total: 11.5 } }), 'draft bill');
      eq(d.status, 'Draft', 'draft'); must(await c.del(`/api/finance/records/apinvoice/${d.id}`), 'delete draft');
      return au.length + ' audit rows';
    });

    u.manual('AP-13', 'Bill created from a real purchase order (PO invoice action, 3-way match against received quantities)', 'Needs a purchase order received by the procurement user; the match rule itself is tested in AP-04..06 with PO figures on the bill');
  }
};
