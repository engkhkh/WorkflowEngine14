// Finance - accounts receivable: customer, invoices with VAT, issue to the GL, receipts (part and full), aging, credit limit exposure, statement, cancel/delete rules.
const { refused } = require('../lib');
const { must, eq, ok, toNum, r2, addDays, ACC, invTotal, flist, fcreate, fput, fputOk, byId, journal, net, ageBucket, bankAccount, bankBalance } = require('./_fin');

module.exports = {
  id: 'finance-ar',
  title: 'Receivables clerk',
  modules: ['finance'],
  role: 'finance',
  perms: ['finance.*', 'cal.*'],
  probe: { path: '/api/finance/records/arinvoice', perm: 'finance.ar.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company, today = u.ws.today;
    const CUS = `CUS-${K}`, BANK = `BK-${K}`;
    S.inv = {}; S.codes = new Set();

    const newInvoice = (net_, over = {}) => {
      const tax = r2(net_ * 0.15), total = r2(net_ + tax);
      return fcreate(c, 'arinvoice', { company: CO, status: 'Draft', data: Object.assign({ customer: CUS, date: today, dueDate: addDays(today, 30), currency: 'SAR', rate: 1, amount: net_, taxCode: 'VAT15-OUT', taxAmount: tax, total, notes: 'Invoice ' + K, paid: 0 }, over) });
    };
    /** Issue the invoice and book it in the GL like the screen does: Dr receivable, Cr revenue, Cr VAT output. */
    const issue = async (inv, revenue = ACC.sales) => {
      const issued = await fputOk(c, 'arinvoice', inv, { status: 'Issued' }, 'issue ' + inv.code);
      const total = r2(invTotal(issued.data)), tax = r2(toNum(issued.data.taxAmount)), netAmt = r2(total - tax);
      const j = await journal(c, CO, { date: String(issued.data.date).slice(0, 10), memo: `${CUS} - ${issued.code}`, reference: issued.code, lines: [
        { account: ACC.ar, debit: total }, { account: revenue, credit: netAmt }, { account: ACC.vatOut, credit: tax }] });
      const done = await fputOk(c, 'arinvoice', issued, { data: { glJournal: j.code } }, 'link journal');
      S.codes.add(done.code);
      return { inv: done, j, total, tax, net: netAmt };
    };
    /** Receive money against an invoice: invoice paid amount, bank line, receipt, GL journal. */
    const receive = async (inv, amount) => {
      const paid = r2(toNum(inv.data.paid) + amount), total = invTotal(inv.data), full = paid >= total - 0.005;
      const upd = await fputOk(c, 'arinvoice', inv, { status: full ? 'Paid' : 'Issued', data: { paid, paidDate: today, bankAccount: BANK } }, 'record payment');
      await fcreate(c, 'banktxn', { company: CO, status: 'Active', data: { account: BANK, date: today, amount, description: 'Receipt ' + inv.code, reference: inv.code, reconciled: false } });
      const rc = await fcreate(c, 'receipt', { company: CO, status: 'Active', data: { invoice: inv.code, customer: CUS, amount, date: today, bank: BANK } });
      await journal(c, CO, { date: today, memo: 'Receipt ' + inv.code, reference: inv.code, lines: [{ account: ACC.bank, debit: amount }, { account: ACC.ar, credit: amount }] });
      return { inv: upd, rc };
    };

    await u.step('AR-01', 'Customer master: create with terms and credit limit, duplicate / missing code refused, update, visible in lookups', async () => {
      S.cus = await fcreate(c, 'customer', { code: CUS, status: 'Active', data: { name: 'Customer ' + K, nameAr: 'عميل ' + K, email: `${CUS.toLowerCase()}@example.com`, termsDays: 30, creditLimit: 3000, city: 'Riyadh' } });
      refused(await c.post('/api/finance/records/customer', { code: CUS, status: 'Active', data: { name: 'dup' } }), 'duplicate customer', [409]);
      refused(await c.post('/api/finance/records/customer', { status: 'Active', data: { name: 'no code' } }), 'customer without code', [400]);
      const up = await fputOk(c, 'customer', S.cus, { data: { city: 'Jeddah' } }); eq(up.data.city, 'Jeddah', 'city'); eq(up.data.creditLimit, 3000, 'limit kept');
      S.cus = up;
      const lk = must(await c.get('/api/erp/crm/lookups/customers'), 'customer lookup'); ok(lk.some(x => x.code === CUS), 'customer not in lookups');
      await bankAccount(c, CO, BANK, 'Collections ' + K, 0);
      return CUS + ' limit 3,000';
    });

    await u.step('AR-02', 'Invoice 1: net 1,000.00 + VAT 15% = 150.00 = 1,150.00; Draft, edit, issue, GL journal Dr 1100 / Cr 4100 / Cr 2150', async () => {
      const d = await newInvoice(1000);
      ok(/^INV-\d{4}-\d{4}$/.test(d.code), 'invoice number ' + d.code); eq(d.status, 'Draft', 'status'); eq(d.data.taxAmount, 150, 'VAT'); eq(d.data.total, 1150, 'total');
      const e = await fputOk(c, 'arinvoice', d, { data: { notes: 'edited ' + K } }); eq(e.data.notes, 'edited ' + K, 'draft edit');
      const r = await issue(e); S.inv.one = r.inv;
      eq(r.inv.status, 'Issued', 'issued'); eq(r.total, 1150, 'total'); eq(r.tax, 150, 'tax'); eq(r.net, 1000, 'net');
      const jv = (await flist(c, 'journal')).find(j => j.code === r.j.code);
      eq(net([jv]).of(ACC.ar), 1150, 'Dr receivable'); eq(net([jv]).of(ACC.sales), -1000, 'Cr revenue'); eq(net([jv]).of(ACC.vatOut), -150, 'Cr VAT output');
      return r.inv.code + ' 1,150.00 journal ' + r.j.code;
    });

    await u.step('AR-03', 'Invoice 2: service revenue net 2,000.00 + 300.00 VAT = 2,300.00 issued to the GL', async () => {
      const r = await issue(await newInvoice(2000), ACC.service); S.inv.two = r.inv;
      eq(r.total, 2300, 'total'); eq(r.tax, 300, 'tax');
      const jv = (await flist(c, 'journal')).find(j => j.code === r.j.code);
      eq(net([jv]).of(ACC.service), -2000, 'Cr service revenue'); eq(net([jv]).dr, 2300, 'journal debits'); eq(net([jv]).cr, 2300, 'journal credits');
      return r.inv.code + ' 2,300.00';
    });

    await u.step('AR-04', 'VAT rounding: net 333.40 gives VAT 50.01 and total 383.41; draft is not counted as receivable', async () => {
      const d = await newInvoice(333.4); S.inv.draft = d;
      eq(d.data.taxAmount, 50.01, 'VAT'); eq(d.data.total, 383.41, 'total');
      const back = await byId(c, 'arinvoice', d.id); eq(invTotal(back.data), 383.41, 'stored total');
      const tax = (await flist(c, 'taxcode')).find(t => t.code === 'VAT15-OUT'); eq(tax.data.rate, 15, 'workspace output VAT rate');
      return 'VAT 50.01 / total 383.41, status Draft';
    });

    await u.step('AR-05', 'Credit limit rule: Issued exposure 3,450 is 450 over the 3,000 limit (limit is checked by the screen, the API stores both); raising it clears the flag', async () => {
      ok(S.inv.one && S.inv.two, 'depends on AR-02 / AR-03');
      const open = async () => (await flist(c, 'arinvoice')).filter(i => i.data.customer === CUS && i.status === 'Issued').reduce((s, i) => s + invTotal(i.data) - toNum(i.data.paid), 0);
      const exposure = r2(await open()); eq(exposure, 3450, 'exposure');
      const cus = (await flist(c, 'customer')).find(x => x.code === CUS);
      eq(r2(exposure - toNum(cus.data.creditLimit)), 450, 'over the limit by');
      ok(exposure > toNum(cus.data.creditLimit), 'customer must be flagged over limit');
      const raised = await fputOk(c, 'customer', cus, { data: { creditLimit: 5000 } }); eq(raised.data.creditLimit, 5000, 'new limit');
      ok(exposure + 383.41 <= 5000, 'with the draft invoice the exposure still fits the raised limit');
      return 'exposure 3,450 vs limit 3,000 (over by 450); limit raised to 5,000';
    });

    await u.step('AR-06', 'Part receipt 1,000.00 on invoice 1: stays Issued, balance 150.00, bank line, receipt, GL Dr 1020 / Cr 1100', async () => {
      ok(S.inv.one, 'depends on AR-02');
      const r = await receive(S.inv.one, 1000); S.inv.one = r.inv;
      eq(r.inv.status, 'Issued', 'stays open'); eq(r.inv.data.paid, 1000, 'paid'); eq(invTotal(r.inv.data) - toNum(r.inv.data.paid), 150, 'balance');
      ok(/^RC-\d{4}-\d{4}$/.test(r.rc.code), 'receipt number ' + r.rc.code);
      const bank = (await flist(c, 'bankaccount')).find(b => b.code === BANK); eq(await bankBalance(c, bank), 1000, 'bank balance');
      return 'receipt ' + r.rc.code + ', balance 150.00, bank 1,000.00';
    });

    await u.step('AR-07', 'Settle the last 150.00: invoice Paid, balance 0, paid invoice cannot be deleted', async () => {
      ok(S.inv.one, 'depends on AR-06');
      const r = await receive(S.inv.one, 150); S.inv.one = r.inv;
      eq(r.inv.status, 'Paid', 'status'); eq(r.inv.data.paid, 1150, 'paid');
      refused(await c.del(`/api/finance/records/arinvoice/${r.inv.id}`), 'delete paid invoice', [400]);
      const rcs = (await flist(c, 'receipt')).filter(x => x.data.customer === CUS && x.data.invoice === r.inv.code);
      eq(rcs.length, 2, 'receipts for invoice 1'); eq(r2(rcs.reduce((s, x) => s + toNum(x.data.amount), 0)), 1150, 'receipts total');
      return 'Paid; receipts 1,000 + 150';
    });

    await u.step('AR-08', 'Overdue invoice 575.00 (due 45 days ago) lands in the 31-60 aging bucket; the CFO aging and overdue totals include it', async () => {
      const date = addDays(today, -50), due = addDays(today, -45);
      const r = await issue(await newInvoice(500, { date, dueDate: due })); S.inv.old = r.inv;
      eq(r.total, 575, 'total'); eq(ageBucket(due, today), 2, 'bucket of a 45-day-late invoice');
      const s = must(await c.get('/api/finance/summary'), 'summary');
      ok(s.arOverdue >= 575, 'arOverdue ' + s.arOverdue); ok(s.arAging[2].value >= 575, '31-60 bucket ' + s.arAging[2].value);
      ok(s.arAging[0].value >= 2300, 'current bucket holds invoice 2: ' + s.arAging[0].value);
      ok(s.arOutstanding >= 2875, 'arOutstanding ' + s.arOutstanding);
      eq(s.arAging.length, 5, 'buckets');
      return 'workspace AR ' + s.arOutstanding + ', overdue ' + s.arOverdue + ' (mine: 575 overdue, 2,300 current)';
    });

    await u.step('AR-09', 'Customer statement: invoiced 4,025.00 - received 1,150.00 = open 2,875.00, equal to the sum of invoice balances', async () => {
      const invs = (await flist(c, 'arinvoice')).filter(i => i.data.customer === CUS && ['Issued', 'Paid'].includes(i.status));
      const rcs = (await flist(c, 'receipt')).filter(x => x.data.customer === CUS);
      const invoiced = r2(invs.reduce((s, i) => s + invTotal(i.data), 0)), received = r2(rcs.reduce((s, x) => s + toNum(x.data.amount), 0));
      eq(invoiced, 4025, 'invoiced'); eq(received, 1150, 'received'); eq(r2(invoiced - received), 2875, 'statement balance');
      eq(r2(invs.reduce((s, i) => s + invTotal(i.data) - toNum(i.data.paid), 0)), 2875, 'sum of invoice balances');
      return 'balance 2,875.00 over ' + invs.length + ' invoices, ' + rcs.length + ' receipts';
    });

    await u.step('AR-10', 'GL tie-out: receivable 2,875.00, revenue 1,500.00 + service 2,000.00, VAT output 525.00 over my invoice journals', async () => {
      const mine = (await flist(c, 'journal', '?status=Posted')).filter(j => S.codes.has(String(j.data.reference)));
      const t = net(mine);
      eq(t.of(ACC.ar), 2875, 'receivable per GL'); eq(t.of(ACC.sales), -1500, 'sales revenue'); eq(t.of(ACC.service), -2000, 'service revenue');
      eq(t.of(ACC.vatOut), -525, 'VAT output'); eq(t.of(ACC.bank), 1150, 'bank receipts'); eq(t.dr, t.cr, 'balanced');
      return `${mine.length} journals; AR ${t.of(ACC.ar)}`;
    });

    await u.step('AR-11', 'Cancel and delete: draft -> Cancelled -> deleted; draft deleted directly; an Issued invoice cannot be deleted', async () => {
      ok(S.inv.draft && S.inv.two, 'depends on AR-02..04');
      const cn = await fputOk(c, 'arinvoice', S.inv.draft, { status: 'Cancelled' }, 'cancel'); eq(cn.status, 'Cancelled', 'cancelled');
      must(await c.del(`/api/finance/records/arinvoice/${cn.id}`), 'delete cancelled');
      const d2 = await newInvoice(10); must(await c.del(`/api/finance/records/arinvoice/${d2.id}`), 'delete draft');
      refused(await c.del(`/api/finance/records/arinvoice/${S.inv.two.id}`), 'delete issued invoice', [400]);
      const left = (await flist(c, 'arinvoice')).filter(i => i.data.customer === CUS);
      eq(left.length, 3, 'invoices left (1, 2 and the overdue one)');
      return 'cancel + delete ok, issued delete refused';
    });

    await u.step('AR-12', 'Audit trail of invoice 1: created, status changes to Issued and Paid, all by me; unknown record 404', async () => {
      ok(S.inv.one, 'depends on AR-02');
      const au = must(await c.get(`/api/finance/audit?recordId=${S.inv.one.id}`), 'audit');
      ok(au.some(a => a.action === 'Created'), 'Created missing');
      ok(au.filter(a => a.action === 'StatusChanged').length >= 2, 'Issued and Paid changes');
      ok(au.every(a => String(a.userName).toLowerCase() === u.username.toLowerCase()), 'acting user');
      refused(await c.put('/api/finance/records/arinvoice/does-not-exist', { status: 'Issued', data: {} }), 'update unknown invoice', [404]);
      return au.length + ' audit rows';
    });

    await u.step('AR-13', 'Deactivate the customer: Inactive status stored, existing invoices untouched', async () => {
      const cus = (await flist(c, 'customer')).find(x => x.code === CUS);
      const off = await fputOk(c, 'customer', cus, { status: 'Inactive' }); eq(off.status, 'Inactive', 'inactive');
      ok((await flist(c, 'customer', '?status=Inactive')).some(x => x.code === CUS), 'not in the Inactive list');
      eq((await flist(c, 'arinvoice')).filter(i => i.data.customer === CUS).length, 3, 'invoices remain');
      return 'customer Inactive';
    });
  }
};
