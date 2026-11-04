// Sales and marketing executive: customer master, quotes with discounts and VAT (Draft -> Sent -> Accepted / Rejected), sales-order workflow
// document, draft receivable invoice, campaigns with recipients and spend, custom module (customer visit log) with a required field.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = {
  id: 'sales-marketing',
  title: 'Sales and marketing executive',
  modules: ['sales', 'mkt', 'cus'],
  role: 'sales',
  perms: ['crm.view', 'crm.accounts.manage', 'crm.quotes.manage', 'crm.campaigns.manage', 'crm.reports.view', 'sales.view', 'sales.create', 'finance.ar.view', 'finance.ar.manage', 'cus.view', 'cus.manage', 'cus.design'],
  probe: { path: '/api/erp/crm/records/quote', perm: 'crm.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company;
    const rec = k => `/api/erp/crm/records/${k}`;
    const list = async (k, qs = '') => must(await c.get(rec(k) + '?take=5000' + qs), 'list ' + k);
    const upd = (k, r, patch = {}) => c.put(rec(k) + '/' + r.id, { company: r.company, branch: r.branch, ref: r.ref, status: patch.status || r.status, data: { ...(r.data || {}), ...(patch.data || {}) } });
    const CUST = `CUS-${K}`, ACC = `ACC-${K}`;
    const totals = (lines, taxPct, orderDiscountPct = 0) => {
      const gross = lines.reduce((s, l) => s + num(l.qty) * num(l.price) * (1 - num(l.discountPct || 0) / 100), 0);
      const discount = r2(gross * orderDiscountPct / 100), net = r2(gross - discount), tax = r2(net * taxPct / 100);
      return { subtotal: r2(gross), discount, net, tax, total: r2(net + tax) };
    };
    const mkQuote = (lines, discountPct, extra = {}) => {
      const t = totals(lines, 15, discountPct);
      return { company: CO, ref: ACC, data: { date: u.ws.today, validUntil: u.ws.today, taxPct: 15, discountPct, lines, subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total, ...extra } };
    };

    await u.step('P10-01', 'Customer master: finance customer, CRM account and contact; customer lookup lists it; duplicate refused', async () => {
      must(await c.post('/api/finance/records/customer', { code: CUST, company: CO, status: 'Active', data: { name: 'Customer ' + K, email: CUST.toLowerCase() + '@example.com', termsDays: 30, creditLimit: 50000, city: 'Jeddah' } }), 'finance customer');
      refused(await c.post('/api/finance/records/customer', { code: CUST, company: CO, status: 'Active', data: { name: 'dup' } }), 'duplicate customer', [409]);
      must(await c.post(rec('account'), { code: ACC, company: CO, data: { name: 'Customer ' + K, industry: 'Retail', phone: '05' + u.tag, owner: u.username } }), 'CRM account');
      S.contacts = [];
      for (const t of ['1', '2', '3']) S.contacts.push(must(await c.post(rec('contact'), { company: CO, ref: ACC, data: { name: `Buyer ${t} ${K}`, email: `buyer${t}.${K.toLowerCase()}@example.com`, phone: '05' + u.tag + t, account: ACC } }), 'contact ' + t).code);
      const lk = must(await c.get('/api/erp/crm/lookups/customers'), 'customer lookup'); ok(lk.some(x => x.code === CUST && x.name === 'Customer ' + K), 'customer missing in lookups/customers');
      return CUST + ' + 3 contacts';
    });

    await u.step('P10-02', 'Quote 1: 10 x 100 less 10% + 5 x 50 = 1,150.00 + VAT 15% 172.50 = 1,322.50; auto QT number, starts Draft', async () => {
      const lines = [{ sku: 'ITM1-' + K, desc: 'Item one', qty: 10, price: 100, discountPct: 10 }, { sku: 'ITM2-' + K, desc: 'Item two', qty: 5, price: 50, discountPct: 0 }];
      const t = totals(lines, 15); eq(t.subtotal, 1150, 'subtotal'); eq(t.tax, 172.5, 'VAT'); eq(t.total, 1322.5, 'total');
      const q = must(await c.post(rec('quote'), mkQuote(lines, 0, { notes: 'Q1 ' + K })), 'create quote'); ok(q.status === 'Draft' && /^QT-/.test(q.code), `${q.code} ${q.status}`);
      eq(q.data.total, 1322.5, 'stored total'); eq(q.data.tax, 172.5, 'stored VAT'); eq(q.data.lines.length, 2, 'lines'); S.q1 = q; S.q1t = t; S.q1lines = lines;
      const ed = must(await upd('quote', q, { data: { notes: 'edited ' + K } }), 'edit draft'); ok(ed.data.notes === 'edited ' + K, 'edit stored'); S.q1 = ed;
      return `${q.code} 1,322.50`;
    });

    await u.step('P10-03', 'Quote 2 with 5% order discount: 20 x 30 = 600 - 30 = 570 + VAT 85.50 = 655.50; duplicate quote code refused', async () => {
      const lines = [{ sku: 'ITM3-' + K, desc: 'Item three', qty: 20, price: 30, discountPct: 0 }];
      const t = totals(lines, 15, 5); eq(t.discount, 30, 'discount'); eq(t.net, 570, 'net'); eq(t.tax, 85.5, 'VAT'); eq(t.total, 655.5, 'total');
      const body = mkQuote(lines, 5); const q = must(await c.post(rec('quote'), { ...body, code: `Q2-${K}` }), 'create quote 2'); ok(q.code === `Q2-${K}`, 'code ' + q.code); eq(q.data.total, 655.5, 'stored total'); eq(q.data.discount, 30, 'stored discount');
      refused(await c.post(rec('quote'), { ...body, code: `Q2-${K}` }), 'duplicate quote code', [409]);
      S.q2 = q; return q.code + ' 655.50';
    });

    await u.step('P10-04', 'Quote status flow: Q1 Sent -> Accepted; Q2 Sent -> Rejected; accepted total of my quotes = 1,322.50', async () => {
      ok(S.q1 && S.q2, 'depends on P10-02/03');
      let a = must(await upd('quote', S.q1, { status: 'Sent' }), 'send Q1'); ok(a.status === 'Sent', a.status); a = must(await upd('quote', a, { status: 'Accepted' }), 'accept Q1'); ok(a.status === 'Accepted', a.status); S.q1 = a;
      let b = must(await upd('quote', S.q2, { status: 'Sent' }), 'send Q2'); b = must(await upd('quote', b, { status: 'Rejected', data: { rejectReason: 'Price' } }), 'reject Q2'); ok(b.status === 'Rejected', b.status); S.q2 = b;
      const mine = (await list('quote')).filter(x => x.ref === ACC); eq(mine.length, 2, 'my quotes');
      eq(mine.filter(x => x.status === 'Accepted').reduce((s, x) => s + num(x.data.total), 0), 1322.5, 'accepted value'); eq(mine.filter(x => x.status === 'Rejected').length, 1, 'rejected');
      const acc = must(await c.get(rec('quote') + '?status=Accepted&take=5000'), 'filter'); ok(acc.some(x => x.id === a.id) && acc.every(x => x.status === 'Accepted'), 'status filter');
      return 'Accepted 1,322.50, Rejected 1';
    });

    await u.step('P10-05', 'Accepted quote -> Sales Order workflow document with the same lines and totals (waiting at its first approval)', async () => {
      ok(S.q1 && S.q1.status === 'Accepted', 'depends on P10-04');
      const defs = must(await c.get('/api/definitions'), 'definitions'); const def = defs.find(d => /sales order/i.test(d.name || '') && d.isPublished !== false); ok(def, 'workflow "Sales Order (Order-to-Cash)" not found');
      const t = S.q1t, lines = S.q1lines;
      const data = { docType: 'SO', docNumber: 'SO-' + K, module: 'sales', company: CO, branch: u.ws.branch.JED, warehouse: 'JED-MAIN', docDate: u.ws.today, party: 'Customer ' + K, currency: 'SAR', notes: 'From quote ' + S.q1.code,
        lines: lines.map(l => ({ item: l.sku, description: l.desc, qty: l.qty, unit: 'pcs', unitPrice: l.price, amount: r2(l.qty * l.price * (1 - l.discountPct / 100)) })), subtotal: t.subtotal, discountPct: 0, discountAmount: 0, vatPct: 15, vatAmount: t.tax, total: t.total, requesterName: 'Exec ' + K };
      const inst = must(await c.post('/api/instances/start', { definitionId: def.id, initialData: data }), 'start sales order'); ok(inst.id, 'no instance id'); ok(/running/i.test(String(inst.status)), 'instance status ' + inst.status);
      eq(inst.data && inst.data.total, 1322.5, 'order total'); eq(String(inst.startedBy).toLowerCase(), u.username.toLowerCase(), 'started by'); S.so = inst;
      const back = must(await c.get('/api/instances/' + inst.id), 'read order'); eq(back.id === inst.id ? 1 : 0, 1, 'readable');
      refused(await c.post('/api/instances/start', { definitionId: 'no-such-definition-' + K, initialData: data }), 'unknown workflow', [404, 400]);
      return `SO-${K} total ${inst.data.total}`;
    });

    await u.step('P10-06', 'Draft receivable invoice for the accepted quote: 1,150 + 172.50 = 1,322.50 in the customer account; list and total agree', async () => {
      ok(S.q1 && S.q1.status === 'Accepted', 'depends on P10-04');
      const inv = must(await c.post('/api/finance/records/arinvoice', { company: CO, status: 'Draft', data: { customer: CUST, date: u.ws.today, dueDate: u.ws.today, currency: '', rate: 1, amount: S.q1t.net, taxAmount: S.q1t.tax, total: S.q1t.total, paid: 0, quote: S.q1.code, notes: 'Invoice for ' + S.q1.code,
        lines: S.q1lines.map(l => ({ description: `${l.sku} ${l.desc}`, qty: l.qty, price: l.price, amount: r2(l.qty * l.price * (1 - l.discountPct / 100)) })) } }), 'create invoice');
      ok(inv.status === 'Draft', 'status ' + inv.status); eq(inv.data.total, 1322.5, 'invoice total'); S.inv = inv;
      const ar = must(await c.get('/api/finance/records/arinvoice'), 'receivables').filter(x => x.data && x.data.customer === CUST); eq(ar.length, 1, 'invoices of the customer'); eq(ar.reduce((s, x) => s + num(x.data.total), 0), 1322.5, 'receivable');
      eq(num(ar[0].data.amount) + num(ar[0].data.taxAmount), 1322.5, 'net + VAT');
      return `${inv.code} Draft 1,322.50`;
    });

    await u.step('P10-07', 'Campaign: 3 recipients, budget 2,000, spend 0 of 2,000; auto CMP number; recipients stored', async () => {
      ok(S.contacts && S.contacts.length === 3, 'depends on P10-01');
      const data = { name: 'Autumn offer ' + K, type: 'Email', start: u.ws.today, end: u.ws.today, budget: 2000, spent: 0, recipients: S.contacts, recipientCount: 3, notes: 'Offer ' + K };
      const cmp = must(await c.post(rec('campaign'), { company: CO, status: 'Active', data }), 'create campaign'); ok(/^CMP-/.test(cmp.code), cmp.code); S.cmp = cmp;
      const back = (await list('campaign')).find(x => x.id === cmp.id); eq(back.data.recipients.length, 3, 'recipients'); eq(back.data.budget, 2000, 'budget'); eq(back.data.spent, 0, 'spend'); ok(back.status === 'Active', back.status);
      for (const ct of S.contacts) ok(back.data.recipients.includes(ct), 'recipient ' + ct);
      return cmp.code;
    });

    await u.step('P10-08', 'Campaign spend: 450 then 700 = 1,150 of 2,000; remaining 850; cost per recipient 383.33; then Completed', async () => {
      ok(S.cmp, 'depends on P10-07');
      let cur = must(await upd('campaign', S.cmp, { data: { spent: 450 } }), 'spend 1'); eq(cur.data.spent, 450, 'spent 1');
      cur = must(await upd('campaign', cur, { data: { spent: num(cur.data.spent) + 700 } }), 'spend 2'); eq(cur.data.spent, 1150, 'spent total');
      eq(r2(num(cur.data.budget) - num(cur.data.spent)), 850, 'remaining'); eq(r2(num(cur.data.spent) / cur.data.recipients.length), 383.33, 'cost per recipient');
      cur = must(await upd('campaign', cur, { status: 'Completed' }), 'complete'); ok(cur.status === 'Completed', cur.status);
      const second = must(await c.post(rec('campaign'), { company: CO, status: 'Active', data: { name: 'Second ' + K, type: 'SMS', budget: 500, spent: 0, recipients: [S.contacts[0]], recipientCount: 1 } }), 'second campaign');
      must(await c.del(rec('campaign') + '/' + second.id), 'delete campaign'); ok(!(await list('campaign')).some(x => x.id === second.id), 'deleted campaign still listed');
      const mine = (await list('campaign')).filter(x => x.data && String(x.data.name || '').includes(K)); eq(mine.length, 1, 'my campaigns'); eq(mine[0].status === 'Completed' ? 1 : 0, 1, 'status kept');
      return 'spent 1,150 of 2,000';
    });

    await u.step('P10-09', 'Custom module "Customer visits": design with a required field, invalid designs refused, save without it refused, save with it, edit, list', async () => {
      const f = (label, type = 'text', required = false, extra = {}) => ({ key: '', label, type, required, ...extra });
      refused(await c.post('/api/custom/modules', { title: 'Empty ' + K, fields: [] }), 'module without fields', [400]);
      refused(await c.post('/api/custom/modules', { title: 'Bad type ' + K, fields: [f('X', 'nonsense')] }), 'unknown field type', [400]);
      refused(await c.post('/api/custom/modules', { title: 'Bad list ' + K, fields: [f('Pick', 'select')] }), 'list field without options', [400]);
      refused(await c.post('/api/custom/modules', { title: '', fields: [f('X')] }), 'module without a name', [400]);
      const def = { title: 'Customer visits ' + K, icon: 'users', color: '#0ea5e9', fields: [f('Customer', 'text', true), f('Visit date', 'date'), f('Outcome', 'select', false, { options: ['Won', 'Follow-up', 'Lost'] }), f('Notes', 'textarea')] };
      const m = must(await c.post('/api/custom/modules', def), 'create module'); S.mod = m; const key = m.key; ok(key.includes(K.toLowerCase()), 'module key ' + key);
      const withExtra = { ...m.def, fields: [...m.def.fields, f('Badge number', 'text', true)] }; const up = must(await c.put(`/api/custom/modules/${key}`, withExtra), 'add required field');
      const fk = lab => { const x = up.def.fields.find(y => y.label === lab); ok(x, 'field ' + lab); return x.key; }; S.fk = fk;
      ok(up.def.fields.find(y => y.label === 'Badge number').required === true, 'Badge number required');
      const row = { [fk('Customer')]: 'Customer ' + K, [fk('Visit date')]: u.ws.today, [fk('Outcome')]: 'Won', [fk('Notes')]: 'Visit notes' };
      const bad = refused(await c.post(`/api/custom/records/${key}`, { data: row }), 'save without the required field', [400]); ok(/badge number/i.test(bad.text), 'refusal does not name the field: ' + bad.text);
      refused(await c.post(`/api/custom/records/${key}`, { data: { ...row, [fk('Badge number')]: '1', [fk('Outcome')]: 'Bogus' } }), 'value outside the list', [400]);
      const good = must(await c.post(`/api/custom/records/${key}`, { data: { ...row, [fk('Badge number')]: '77' } }), 'save'); ok(good.code, 'record code');
      const ed = must(await c.put(`/api/custom/records/${key}/${good.id}`, { data: { ...row, [fk('Badge number')]: '77', [fk('Outcome')]: 'Follow-up' } }), 'edit record'); eq(ed.data[fk('Outcome')] === 'Follow-up' ? 1 : 0, 1, 'edited outcome');
      const rows = must(await c.get(`/api/custom/records/${key}`), 'list records'); eq(rows.length, 1, 'rows'); S.rec = good;
      ok(must(await c.get('/api/custom/modules'), 'modules').some(x => x.key === key), 'module not in the list');
      return `module ${key}, record ${good.code}`;
    });

    await u.step('P10-10', 'Custom module cleanup: delete the record, then the module; both gone from the lists', async () => {
      ok(S.mod && S.rec, 'depends on P10-09');
      must(await c.del(`/api/custom/records/${S.mod.key}/${S.rec.id}`), 'delete record'); eq(must(await c.get(`/api/custom/records/${S.mod.key}`), 'rows').length, 0, 'rows after delete');
      must(await c.del(`/api/custom/modules/${S.mod.key}`), 'delete module'); ok(!must(await c.get('/api/custom/modules'), 'modules').some(x => x.key === S.mod.key), 'module still listed');
      return 'deleted';
    });

    await u.step('P10-11', 'Refused: no ledger posting or payroll for a sales role; unknown quote id; quote kind via wrong module', async () => {
      refused(await c.post('/api/finance/records/journal', { status: 'Draft', data: { date: u.ws.today, memo: 'x ' + K, lines: [] } }), 'journal create', [400, 401, 403]);
      refused(await c.get('/api/erp/pay/records/run'), 'payroll runs', [401, 403]);
      refused(await c.put(rec('quote') + '/no-such-quote-' + K, { status: 'Sent', data: {} }), 'unknown quote', [404]);
      refused(await c.get('/api/erp/proc/records/quote'), 'quote in procurement', [404]);
      return 'refused';
    });
  },
};
