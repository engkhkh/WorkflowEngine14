// Real Estate (module re): owners, properties, units, tenants, leases with rent schedule, rent collection, renewal/termination,
// unit sales (reservation -> contract -> completed), maintenance requests, overview.
const { must, refused, eq, ok, addDays } = require('../lib');

module.exports = {
  id: 'real-estate',
  title: 'Real estate manager',
  modules: ['re'],
  role: 'realestate',
  perms: ['re.*'],
  probe: { path: '/api/erp/re/records/property', perm: 're.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, ws = u.ws, A = ws.admin, today = ws.today;
    const R = kind => `/api/erp/re/records/${kind}`;
    const ACT = (kind, id, op) => `/api/erp/re/react/${kind}/${id}/${op}`;
    const list = async (cl, kind) => must(await cl.get(R(kind) + '?take=5000'), 'list ' + kind);
    const get = async (cl, kind, id) => { const r = (await list(cl, kind)).find(x => x.id === id); ok(r, `${kind} ${id} not found`); return r; };
    const create = async (cl, kind, data, what, extra) => must(await cl.post(R(kind), Object.assign({ company: ws.company, data }, extra || {})), what || 'create ' + kind);
    const act = async (cl, kind, id, op, body, what) => must(await cl.post(ACT(kind, id, op), body || {}), what || `${kind} ${op}`);
    const tryAct = (cl, kind, id, op, body) => cl.post(ACT(kind, id, op), body || {});
    const unitOf = async code => (await list(c, 'unit')).find(x => x.code === code);

    await u.step('RE-01', 'Owner: auto number OWN-, commission must be 0..100, name required', async () => {
      const o = await create(c, 'owner', { name: `Abdullah Al-Rashid ${K}`, phone: '0551234567', email: `owner.${K}@example.com`.toLowerCase(), commissionPct: 5, iban: 'SA0380000000608010167519' }, 'create owner');
      ok(/^OWN-/.test(o.code), 'number ' + o.code); eq(o.status, 'Active', 'status'); S.owner = o;
      refused(await c.post(R('owner'), { company: ws.company, data: { name: 'x', commissionPct: 101 } }), 'commission 101', [400]);
      refused(await c.post(R('owner'), { company: ws.company, data: { name: '' } }), 'no name', [400]);
      return o.code;
    });

    await u.step('RE-02', 'Property: auto number PRP-, type/owner/name rules', async () => {
      ok(S.owner, 'depends on RE-01');
      const p = await create(c, 'property', { name: `Al Nakheel Tower ${K}`, type: 'Residential', city: 'Riyadh', district: 'Al Olaya', address: 'King Fahd Road', owner: S.owner.code, floors: 12, yearBuilt: 2018, deedNo: '310101' + u.tag }, 'create property');
      ok(/^PRP-/.test(p.code), 'number ' + p.code); eq(p.status, 'Active', 'status'); S.prop = p;
      refused(await c.post(R('property'), { company: ws.company, data: { name: '' } }), 'no name', [400]);
      refused(await c.post(R('property'), { company: ws.company, data: { name: 'x', type: 'Castle' } }), 'bad type', [400]);
      refused(await c.post(R('property'), { company: ws.company, data: { name: 'x', owner: 'OWN-NOPE' } }), 'unknown owner', [400]);
      return p.code;
    });

    await u.step('RE-03', 'Units: three units, duplicate number, zero area, unknown property, Rented can not be set by hand', async () => {
      ok(S.prop, 'depends on RE-02');
      const mk = (no, type, rent, price, extra) => create(c, 'unit', Object.assign({ property: S.prop.code, unitNo: no, floor: 3, type, area: 120, bedrooms: 3, bathrooms: 2, annualRent: rent, salePrice: price }, extra || {}), 'create unit ' + no);
      S.u1 = await mk('301', 'Apartment', 48000, 900000); S.u2 = await mk('302', 'Apartment', 52000, 950000); S.u3 = await mk('G01', 'Shop', 90000, 0, { floor: 0, bedrooms: 0, bathrooms: 1, area: 60 });
      ok(/^UNT-/.test(S.u1.code), 'number'); eq(S.u1.status, 'Available', 'status');
      refused(await c.post(R('unit'), { company: ws.company, data: { property: S.prop.code, unitNo: '301', type: 'Apartment', area: 100 } }), 'duplicate unit number', [400]);
      refused(await c.post(R('unit'), { company: ws.company, data: { property: S.prop.code, unitNo: '999', area: 0 } }), 'zero area', [400]);
      refused(await c.post(R('unit'), { company: ws.company, data: { property: 'PRP-NOPE', unitNo: '1', area: 10 } }), 'unknown property', [400]);
      refused(await c.post(R('unit'), { company: ws.company, status: 'Rented', data: { property: S.prop.code, unitNo: '888', area: 50 } }), 'Rented by hand', [400]);
      return '3 units';
    });

    await u.step('RE-04', 'Tenant: auto number TEN-, e-mail check', async () => {
      const t = await create(c, 'tenant', { name: `Fahad Al-Otaibi ${K}`, phone: '0507654321', email: `fahad.${K}@example.com`.toLowerCase(), nationalId: '1' + String(100000000 + Number(u.tag)), nationality: 'Saudi', employer: 'Saudi Aramco' }, 'create tenant');
      ok(/^TEN-/.test(t.code), 'number'); S.ten = t;
      refused(await c.post(R('tenant'), { company: ws.company, data: { name: 'x', email: 'not-an-email' } }), 'bad e-mail', [400]);
      return t.code;
    });

    await u.step('RE-05', 'Lease rules: dates, unknown unit/tenant, zero rent, bad frequency', async () => {
      ok(S.u1 && S.ten, 'depends on RE-03/04');
      const base = { unit: S.u1.code, tenant: S.ten.code, startDate: today, endDate: addDays(today, 364), annualRent: 48000, frequency: 'Quarterly', deposit: 4800 };
      const bad = async (d, why) => refused(await c.post(R('lease'), { company: ws.company, data: Object.assign({}, base, d) }), why, [400]);
      await bad({ endDate: addDays(today, -5) }, 'end before start'); await bad({ unit: 'UNT-NOPE' }, 'unknown unit'); await bad({ tenant: 'TEN-NOPE' }, 'unknown tenant');
      await bad({ annualRent: 0 }, 'zero rent'); await bad({ frequency: 'Weekly' }, 'bad frequency'); await bad({ deposit: -1 }, 'negative deposit');
      return 'all refused';
    });

    await u.step('RE-06', 'Lease: draft -> activate creates 4 quarterly installments summing to the rent; unit becomes Rented', async () => {
      ok(S.u1 && S.ten, 'depends on RE-03/04');
      const l = await create(c, 'lease', { unit: S.u1.code, tenant: S.ten.code, startDate: today, endDate: addDays(today, 364), annualRent: 48000, frequency: 'Quarterly', deposit: 4800 }, 'create lease');
      ok(/^LSE-/.test(l.code), 'number'); eq(l.status, 'Draft', 'status'); S.l1 = l;
      refused(await c.put(R('lease') + '/' + l.id, { status: 'Active' }), 'activate through edit', [400]);
      const a = await act(c, 'lease', l.id, 'activate'); eq(a.status, 'Active', 'lease status');
      const ins = (await list(c, 'installment')).filter(x => x.ref === l.code).sort((x, y) => String(x.data.dueDate).localeCompare(String(y.data.dueDate)));
      eq(ins.length, 4, 'installments'); eq(Math.round(ins.reduce((s, x) => s + x.data.amount, 0) * 100) / 100, 48000, 'sum of installments');
      ok(ins.every(x => x.status === 'Due' && /^INS-/.test(x.code)), 'all Due with INS- numbers'); eq(ins[0].data.dueDate, today, 'first due date');
      eq((await unitOf(S.u1.code)).status, 'Rented', 'unit status'); S.ins = ins;
      return '4 x 12,000';
    });

    await u.step('RE-07', 'A rented unit cannot get a second lease; the unit cannot be edited back to Available by hand', async () => {
      ok(S.l1, 'depends on RE-06');
      const l2 = await create(c, 'lease', { unit: S.u1.code, tenant: S.ten.code, startDate: addDays(today, 400), endDate: addDays(today, 764), annualRent: 50000, frequency: 'Monthly' }, 'second draft');
      refused(await tryAct(c, 'lease', l2.id, 'activate'), 'second active lease on one unit', [400]);
      const un = await unitOf(S.u1.code);
      refused(await c.put(R('unit') + '/' + un.id, { status: 'Available', data: un.data }), 'release by hand', [400]);
      must(await c.del(R('lease') + '/' + l2.id), 'delete the unused draft');
      return 'refused';
    });

    await u.step('RE-08', 'Collect rent: partial -> Partial, over-payment refused, rest -> Paid, closed installment refused', async () => {
      ok(S.ins, 'depends on RE-06');
      const i0 = S.ins[0];
      const p1 = await act(c, 'installment', i0.id, 'collect', { amount: 5000, method: 'Transfer' }); eq(p1.status, 'Partial', 'partial'); eq(p1.data.paid, 5000, 'paid');
      refused(await tryAct(c, 'installment', i0.id, 'collect', { amount: 8000 }), 'more than due', [400]);
      refused(await tryAct(c, 'installment', i0.id, 'collect', { amount: 100, method: 'Bitcoin' }), 'bad method', [400]);
      const p2 = await act(c, 'installment', i0.id, 'collect', { amount: 7000, method: 'Cheque' }); eq(p2.status, 'Paid', 'paid in full'); eq(p2.data.paid, 12000, 'total paid');
      refused(await tryAct(c, 'installment', i0.id, 'collect', { amount: 1 }), 'collect on a paid one', [400]);
      return '12,000 collected';
    });

    await u.step('RE-09', 'Installments are created by the system only: no manual create, edit or delete', async () => {
      ok(S.ins, 'depends on RE-06');
      refused(await c.post(R('installment'), { company: ws.company, data: { lease: S.l1.code, amount: 1, dueDate: today } }), 'manual installment', [400]);
      refused(await c.put(R('installment') + '/' + S.ins[1].id, { status: 'Paid', data: S.ins[1].data }), 'edit installment', [400]);
      refused(await c.del(R('installment') + '/' + S.ins[1].id), 'delete installment', [400]);
      return 'refused';
    });

    await u.step('RE-10', 'Renew with +5%: next draft lease starts the day after the end, rent 50,400; renewing twice is refused', async () => {
      ok(S.l1, 'depends on RE-06');
      refused(await tryAct(c, 'lease', S.l1.id, 'renew', { percent: 500 }), 'absurd increase', [400]);
      await act(c, 'lease', S.l1.id, 'renew', { percent: 5 });
      const old = await get(c, 'lease', S.l1.id); ok(old.data.renewedTo, 'renewedTo set');
      const nx = (await list(c, 'lease')).find(x => x.code === old.data.renewedTo); ok(nx, 'next lease exists');
      eq(nx.status, 'Draft', 'status'); eq(nx.data.annualRent, 50400, 'rent'); eq(nx.data.startDate, addDays(S.l1.data.endDate, 1), 'start date'); eq(nx.data.renewedFrom, S.l1.code, 'renewedFrom');
      refused(await tryAct(c, 'lease', S.l1.id, 'renew', { percent: 5 }), 'renew twice', [400]);
      return nx.code;
    });

    await u.step('RE-11', 'Terminate: reason required; unit Available again; future unpaid installments Cancelled, the paid one stays', async () => {
      ok(S.l1, 'depends on RE-06');
      refused(await tryAct(c, 'lease', S.l1.id, 'terminate', {}), 'no reason', [400]);
      const t = await act(c, 'lease', S.l1.id, 'terminate', { note: 'Tenant relocated to another city' }); eq(t.status, 'Terminated', 'status');
      eq((await unitOf(S.u1.code)).status, 'Available', 'unit released');
      const ins = (await list(c, 'installment')).filter(x => x.ref === S.l1.code);
      eq(ins.filter(x => x.status === 'Cancelled').length, 3, 'cancelled'); eq(ins.filter(x => x.status === 'Paid').length, 1, 'paid stays');
      refused(await tryAct(c, 'lease', S.l1.id, 'terminate', { note: 'again' }), 'terminate twice', [400]);
      return '3 cancelled';
    });

    await u.step('RE-12', 'Sale: reservation -> contract (unit Reserved) -> completed (unit Sold); rules on price, deposit and sold units', async () => {
      ok(S.u2, 'depends on RE-03');
      refused(await c.post(R('sale'), { company: ws.company, data: { unit: S.u2.code, buyer: 'x', price: 100, deposit: 500 } }), 'deposit above price', [400]);
      refused(await c.post(R('sale'), { company: ws.company, data: { unit: S.u2.code, buyer: '', price: 100 } }), 'no buyer', [400]);
      const s = await create(c, 'sale', { unit: S.u2.code, buyer: `Khalid Al-Mutairi ${K}`, buyerPhone: '0561112233', price: 950000, deposit: 50000, date: today }, 'reservation');
      ok(/^SAL-/.test(s.code), 'number'); eq(s.status, 'Reservation', 'status');
      refused(await tryAct(c, 'sale', s.id, 'complete'), 'complete before contract', [400]);
      eq((await act(c, 'sale', s.id, 'contract')).status, 'Contract', 'contract'); eq((await unitOf(S.u2.code)).status, 'Reserved', 'unit reserved');
      eq((await act(c, 'sale', s.id, 'complete')).status, 'Completed', 'completed'); eq((await unitOf(S.u2.code)).status, 'Sold', 'unit sold');
      refused(await tryAct(c, 'sale', s.id, 'cancel', { note: 'late' }), 'cancel after completion', [400]);
      refused(await c.post(R('sale'), { company: ws.company, data: { unit: S.u2.code, buyer: 'Another', price: 900000 } }), 'sell a sold unit', [400]);
      S.sale = s; return s.code;
    });

    await u.step('RE-13', 'Sale cancelled: reason required, unit goes back to Available', async () => {
      ok(S.u3, 'depends on RE-03');
      const s = await create(c, 'sale', { unit: S.u3.code, buyer: `Sara Al-Qahtani ${K}`, price: 1200000, deposit: 0, date: today }, 'reservation 2');
      await act(c, 'sale', s.id, 'contract'); eq((await unitOf(S.u3.code)).status, 'Reserved', 'reserved');
      refused(await tryAct(c, 'sale', s.id, 'cancel', {}), 'no reason', [400]);
      eq((await act(c, 'sale', s.id, 'cancel', { note: 'Buyer could not get financing' })).status, 'Cancelled', 'cancelled');
      eq((await unitOf(S.u3.code)).status, 'Available', 'unit released'); return s.code;
    });

    await u.step('RE-14', 'Maintenance: new -> assigned -> in progress -> done with cost; a finished request is final', async () => {
      ok(S.prop, 'depends on RE-02');
      const r = await create(c, 'request', { title: `Water leak in bathroom ${K}`, property: S.prop.code, unit: S.u1.code, category: 'Plumbing', priority: 'High', reportedBy: 'Tenant' }, 'create request');
      ok(/^MNT-/.test(r.code), 'number'); eq(r.status, 'New', 'status');
      refused(await c.post(R('request'), { company: ws.company, data: { title: '' } }), 'no title', [400]);
      refused(await c.post(R('request'), { company: ws.company, data: { title: 'x' } }), 'no property or unit', [400]);
      refused(await tryAct(c, 'request', r.id, 'assign', { user: 'nobody-' + K }), 'unknown user', [400]);
      eq((await act(c, 'request', r.id, 'assign', { user: u.username })).status, 'Assigned', 'assigned');
      eq((await act(c, 'request', r.id, 'start')).status, 'InProgress', 'in progress');
      refused(await tryAct(c, 'request', r.id, 'complete', { cost: -5 }), 'negative cost', [400]);
      const d = await act(c, 'request', r.id, 'complete', { cost: 350, note: 'Pipe replaced' }); eq(d.status, 'Done', 'done'); eq(d.data.cost, 350, 'cost');
      refused(await c.put(R('request') + '/' + r.id, { status: 'New', data: d.data }), 'reopen', [400]);
      return r.code;
    });

    await u.step('RE-15', 'Overview: KPIs and lists reflect the data above', async () => {
      const s = must(await c.get('/api/erp/re/summary'), 'summary');
      const k = n => { const x = (s.kpis || []).find(y => (y.k || y.K) === n); ok(x, 'kpi ' + n); return Number(x.v ?? x.V); };
      ok(k('properties') >= 1, 'properties'); ok(k('units') >= 3, 'units'); ok(k('collectedMonth') >= 12000, 'collected this month ' + k('collectedMonth'));
      ok(k('soldYear') >= 950000, 'sold this year ' + k('soldYear')); ok(k('occupancyPct') >= 0 && k('occupancyPct') <= 100, 'occupancy');
      ok((s.lists || []).some(l => (l.k || l.K) === 'unitsByStatus'), 'unitsByStatus list');
      return `${k('units')} units, ${k('occupancyPct')}% occupied`;
    });

    await u.step('RE-16', 'Privileges: a finance user can not read or change real estate data; admin sees this workspace data', async () => {
      const other = ws.clients[1]; ok(other, 'no second user');
      refused(await other.get(R('property')), 'finance user reads properties', [403]);
      refused(await other.post(R('owner'), { company: ws.company, data: { name: 'x' } }), 'finance user creates owner', [403]);
      ok((await list(A, 'property')).some(x => S.prop && x.id === S.prop.id), 'admin sees the property');
      return 'ok';
    });
  }
};
