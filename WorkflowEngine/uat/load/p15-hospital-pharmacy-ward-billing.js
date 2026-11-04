// Hospital pharmacy, wards and billing: own formulary, wards and beds, three/four patients; dispense partial then full, restock, admit/transfer/discharge, invoices per visit, payments, overview.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const body = (kind, code, data, extra = {}) => ({ id: 'new', kind, code, data, ...extra });

module.exports = {
  id: 'hospital-pharmacy-ward-billing',
  title: 'Hospital pharmacy, ward and billing desk',
  modules: ['hos'],
  role: 'doctor',
  perms: ['hos.*'],
  probe: { path: '/api/hospital/records/invoice', perm: 'hos.billing.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, TODAY = u.ws.today;
    const DR = `DR-${K}`, SRV = `SRV-${K}`, AMOX = `AMOX-${K}`, PARA = `PARA-${K}`, W1 = `WA-${K}`, W2 = `WB-${K}`, B1 = `BA1-${K}`, B2 = `BA2-${K}`, B3 = `BA3-${K}`, B4 = `BB1-${K}`;
    const list = async (kind, qs = '') => must(await c.get(`/api/hospital/records/${kind}${qs}`), 'list ' + kind);
    const post = async (kind, code, data, extra) => must(await c.post(`/api/hospital/records/${kind}`, body(kind, code, data, extra)), `create ${kind} ${code}`);
    const drug = async code => (await list('drug')).find(d => d.code === code);
    const bed = async code => (await list('bed')).find(b => b.code === code);
    const invOf = async visitCode => (await list('invoice', `?parent=${visitCode}`))[0];
    const regP = (name, nid, extraData = {}) => c.post('/api/hospital/records/patient', body('patient', null, { name: `${name} ${K}`, sex: 'M', dob: '1980-01-01', phone: '+96651' + u.tag + '00', nationalId: `NID-${K}-${nid}`, allergies: [], conditions: [], ...extraData }));
    const pay = (inv, amount, method = 'cash', extra = {}) => c.post(`/api/hospital/invoices/${inv.id}/pay`, { amount, method, ...extra });
    const dx = id => c.put(`/api/hospital/visits/${id}`, { diagnoses: [{ code: 'Z00', name: 'General examination' }] });

    await u.step('P15-01', 'Setup: doctor (fee 200), service, wards A (350/day) and B (800/day) with 3 + 1 beds, two medicines; duplicates and bed without ward refused', async () => {
      await post('doctor', DR, { name: `Dr. Ward ${K}`, department: 'GEN', fee: 200, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', slot: 15 });
      await post('service', SRV, { name: `Dressing ${K}`, category: 'procedure', price: 60 });
      await post('ward', W1, { name: `General ${K}`, rate: 350 }); await post('ward', W2, { name: `ICU ${K}`, rate: 800 });
      refused(await c.post('/api/hospital/records/ward', body('ward', W1, { name: 'dup', rate: 1 })), 'duplicate ward', [409]);
      refused(await c.post('/api/hospital/records/bed', body('bed', 'X-' + K, { label: 'x' }, { parent: 'NO-WARD-' + K })), 'bed without a real ward', [400]);
      for (const b of [B1, B2, B3]) await post('bed', b, { label: b }, { parent: W1 });
      await post('bed', B4, { label: B4 }, { parent: W2 });
      await post('drug', AMOX, { name: `Amoxicillin ${K}`, class: 'penicillin', strength: '500 mg', form: 'Capsule', price: 1.2, stock: 10, reorder: 5 });
      await post('drug', PARA, { name: `Paracetamol ${K}`, class: 'analgesic', strength: '500 mg', form: 'Tablet', price: 0.3, stock: 200, reorder: 200 });
      const beds = (await list('bed')).filter(b => b.code.endsWith(K) && b.parent && [W1, W2].includes(b.parent));
      eq(beds.length, 4, 'beds'); ok(beds.every(b => b.status === 'Available'), 'all beds Available');
      eq((await list('ward')).find(w => w.code === W2).data.rate, 800, 'ward B rate');
      return '2 wards, 4 beds, 2 medicines';
    });

    await u.step('P15-02', 'Pharmacy stock: +5 (batch, expiry) then -5 damage; zero, no reason and below-zero refused; editing the drug cannot change stock; ledger has the moves', async () => {
      const a = await drug(AMOX); ok(a, 'depends on P15-01'); eq(a.data.stock, 10, 'opening');
      refused(await c.post(`/api/hospital/drugs/${a.id}/stock`, { delta: 0, reason: 'x' }), 'zero quantity', [400]);
      refused(await c.post(`/api/hospital/drugs/${a.id}/stock`, { delta: 5 }), 'no reason', [400]);
      refused(await c.post(`/api/hospital/drugs/${a.id}/stock`, { delta: -500, reason: 'too many' }), 'below zero', [400]);
      const s1 = must(await c.post(`/api/hospital/drugs/${a.id}/stock`, { delta: 5, reason: 'purchase', batch: 'B-' + K, expiry: addDays(TODAY, 365) }), 'receive'); eq(s1.data.stock, 15, 'stock after +5'); eq(s1.data.expiry, addDays(TODAY, 365), 'expiry');
      const s2 = must(await c.post(`/api/hospital/drugs/${a.id}/stock`, { delta: -5, reason: 'damage' }), 'damage'); eq(s2.data.stock, 10, 'stock after -5');
      must(await c.put(`/api/hospital/records/drug/${a.id}`, body('drug', AMOX, { ...s2.data, stock: 9999, price: 1.2 })), 'edit drug');
      eq((await drug(AMOX)).data.stock, 10, 'stock must not change by editing');
      const mv = await list('drugmove', `?parent=${AMOX}`); eq(mv.length, 2, 'ledger moves'); ok(mv.some(m => m.data.delta === 5 && m.data.balance === 15) && mv.some(m => m.data.delta === -5 && m.data.balance === 10), 'moves with balance');
      refused(await c.post(`/api/hospital/drugs/nope-${K}/stock`, { delta: 1, reason: 'x' }), 'unknown drug', [404]);
      return 'stock 10, 2 moves';
    });

    await u.step('P15-03', 'Register patients: Omar (outpatient), Layla (inpatient), Insured (80%, valid), Expired (80%, expired policy)', async () => {
      const mk = async (n, id, d) => must(await regP(n, id, d), 'register ' + n);
      S.p1 = await mk('Omar', 'O'); S.p2 = await mk('Layla', 'L');
      S.p3 = await mk('Insured', 'I', { insurance: { company: 'Test Insurance', policyNo: 'POL-' + K, coveragePct: 80, validUntil: addDays(TODAY, 365) } });
      S.p4 = await mk('Expired', 'E', { insurance: { company: 'Old Insurance', policyNo: 'OLD-' + K, coveragePct: 80, validUntil: '2020-01-01' } });
      ok([S.p1, S.p2, S.p3, S.p4].every(p => /^MRN-\d{6}$/.test(p.code)), 'file numbers');
      eq(S.p3.data.insurance.coveragePct, 80, 'insurance saved');
      return [S.p1.code, S.p2.code, S.p3.code, S.p4.code].join(', ');
    });

    await u.step('P15-04', 'Visit 1 (Omar): diagnosis, dressing x2 = 120, prescription AMOX 15 capsules (stock only 10), Pending', async () => {
      ok(S.p1, 'depends on P15-03');
      const v = must(await c.post('/api/hospital/visits', { patient: S.p1.code, doctor: DR, type: 'OPD', complaint: 'Wound ' + K, today: TODAY }), 'start visit');
      ok(v.status === 'Open' && /^VIS-/.test(v.code), 'visit ' + v.status); eq(v.data.queue, 1, 'queue');
      refused(await c.post('/api/hospital/visits', { patient: 'MRN-NOPE', doctor: DR }), 'visit unknown patient', [400]);
      refused(await c.post('/api/hospital/visits', { patient: S.p1.code, doctor: 'DR-NOPE-' + K }), 'visit unknown doctor', [400]);
      must(await dx(v.id), 'diagnosis');
      must(await c.post(`/api/hospital/visits/${v.id}/services`, { service: SRV, qty: 2 }), 'service');
      const rx = must(await c.post(`/api/hospital/visits/${v.id}/prescriptions`, { items: [{ drug: AMOX, dose: '500 mg', frequency: '3 times a day', days: 5, qty: 15 }] }), 'prescribe');
      eq(rx.data.warnings.length, 0, 'no warning'); eq(rx.status, 'Pending', 'Pending'); S.v1 = v; S.rx1 = rx; return v.code + ' / ' + rx.code;
    });

    await u.step('P15-05', 'Dispense: without partial refused (shortage); partial gives 10 of 15 (stock 0, Partial); nothing left to give refused; restock +100; rest given: Dispensed, stock 95', async () => {
      ok(S.rx1, 'depends on P15-04');
      const sh = refused(await c.post(`/api/hospital/prescriptions/${S.rx1.id}/dispense`, {}), 'dispense without stock', [409]); ok(/Not enough stock/i.test(sh.text), 'shortage message: ' + sh.text);
      const p1 = must(await c.post(`/api/hospital/prescriptions/${S.rx1.id}/dispense`, { allowPartial: true }), 'partial');
      eq(p1.status, 'Partial', 'status'); eq(p1.data.items[0].dispensed, 10, 'dispensed'); eq((await drug(AMOX)).data.stock, 0, 'stock after partial');
      refused(await c.post(`/api/hospital/prescriptions/${S.rx1.id}/dispense`, { allowPartial: true }), 'nothing in stock', [400]);
      const inv = await invOf(S.v1.code); ok(inv, 'invoice follows the dispensing'); eq(inv.data.lines.find(l => l.type === 'drug').amount, 12, 'drug line after partial (10 x 1.20)');
      const a = await drug(AMOX); must(await c.post(`/api/hospital/drugs/${a.id}/stock`, { delta: 100, reason: 'purchase ' + K }), 'restock');
      const p2 = must(await c.post(`/api/hospital/prescriptions/${S.rx1.id}/dispense`, {}), 'rest'); eq(p2.status, 'Dispensed', 'status'); eq(p2.data.items[0].dispensed, 15, 'total dispensed');
      eq((await drug(AMOX)).data.stock, 95, 'stock at the end'); ok(p2.data.dispensedBy, 'dispensed by');
      refused(await c.post(`/api/hospital/prescriptions/${S.rx1.id}/dispense`, {}), 'dispense twice', [400]);
      refused(await c.post(`/api/hospital/prescriptions/${S.rx1.id}/cancel`, {}), 'cancel a dispensed prescription', [400]);
      const mv = await list('drugmove', `?parent=${AMOX}`); ok(mv.length >= 5, 'moves (+5, -5, dispense 10, restock 100, dispense 5): ' + mv.length);
      return 'Partial 10/15 -> restock -> Dispensed 15/15; stock 95';
    });

    await u.step('P15-06', 'Invoice of visit 1 after closing: consult 200 + dressing 120 + AMOX 18.00 = 338.00; one invoice per visit even when rebuilt', async () => {
      ok(S.v1, 'depends on P15-04');
      const cl = must(await c.post(`/api/hospital/visits/${S.v1.id}/close`, {}), 'close visit'); eq(cl.visit.status, 'Closed', 'closed');
      const inv = cl.invoice; const lines = inv.data.lines.map(l => `${l.type} ${l.amount}`).join(', ');
      eq(inv.data.gross, 338, 'gross: ' + lines); eq(inv.data.total, r2(num(inv.data.gross) + num(inv.data.tax)), 'total = gross + tax'); eq(inv.data.insurance, 0, 'no insurance'); eq(inv.data.due, inv.data.total, 'due = total'); ok(inv.status === 'Unpaid', 'status ' + inv.status);
      const again = must(await c.post(`/api/hospital/visits/${S.v1.id}/invoice`, {}), 'rebuild'); ok(again.id === inv.id, 'rebuild must update the same invoice'); eq(again.data.total, inv.data.total, 'same total');
      eq((await list('invoice', `?parent=${S.v1.code}`)).length, 1, 'invoices of the visit');
      refused(await c.post(`/api/hospital/visits/nope-${K}/invoice`, {}), 'invoice of unknown visit', [404]);
      S.inv1 = inv; return inv.code + ' ' + inv.data.total + ' [' + lines + ']';
    });

    await u.step('P15-07', 'Payments on invoice 1: zero, over the balance (message shows it), unknown method refused; 100 cash = Partial; rest by card = Paid; paying a settled invoice refused', async () => {
      ok(S.inv1, 'depends on P15-06');
      const due = num(S.inv1.data.due);
      refused(await pay(S.inv1, 0), 'zero amount', [400]);
      const over = refused(await pay(S.inv1, 10000), 'overpayment', [400]); ok(/more than the balance/i.test(over.text), 'message should say more than the balance: ' + over.text);
      refused(await pay(S.inv1, 10, 'bitcoin'), 'unknown method', [400]);
      const p1 = must(await pay(S.inv1, 100, 'cash'), '100 cash'); eq(p1.status, 'Partial', 'status'); eq(p1.data.paid, 100, 'paid'); eq(p1.data.balance, r2(due - 100), 'balance');
      const p2 = must(await pay(S.inv1, r2(due - 100), 'card', { ref: 'CARD-' + K }), 'rest'); eq(p2.status, 'Paid', 'status'); eq(p2.data.balance, 0, 'balance'); eq(p2.data.payments.length, 2, 'payments');
      refused(await pay(S.inv1, 1), 'pay a settled invoice', [400]);
      return `due ${due}: 100 cash + ${r2(due - 100)} card`;
    });

    await u.step('P15-08', 'Insurance: valid policy 80% covers 160 of 200, patient owes 40 (overpay refused, 40 = Paid); expired policy covers nothing', async () => {
      ok(S.p3 && S.p4, 'depends on P15-03');
      const v3 = must(await c.post('/api/hospital/visits', { patient: S.p3.code, doctor: DR, type: 'OPD', complaint: 'Insured ' + K, today: TODAY }), 'visit 3'); must(await dx(v3.id), 'dx 3');
      const c3 = must(await c.post(`/api/hospital/visits/${v3.id}/close`, {}), 'close 3'); const i3 = c3.invoice;
      eq(i3.data.gross, 200, 'gross'); eq(i3.data.insurancePct, 80, 'coverage'); eq(i3.data.insurance, r2(num(i3.data.total) * 0.8), 'insurance share'); eq(i3.data.due, r2(num(i3.data.total) * 0.2), 'patient share'); ok(i3.data.insuranceName === 'Test Insurance', 'insurer name');
      const due3 = num(i3.data.due);
      refused(await pay(i3, due3 + 1), 'more than the patient share', [400]);
      const p = must(await pay(i3, due3, 'cash'), 'pay share'); eq(p.status, 'Paid', 'Paid with the insurer share left out'); eq(p.data.balance, 0, 'balance');
      const v4 = must(await c.post('/api/hospital/visits', { patient: S.p4.code, doctor: DR, type: 'OPD', complaint: 'Expired ' + K, today: TODAY }), 'visit 4'); must(await dx(v4.id), 'dx 4');
      const i4 = must(await c.post(`/api/hospital/visits/${v4.id}/close`, {}), 'close 4').invoice;
      eq(i4.data.insurance, 0, 'expired policy covers nothing'); eq(i4.data.due, i4.data.total, 'patient owes all'); ok(i4.status === 'Unpaid', 'stays Unpaid'); S.inv4 = i4; S.inv3 = p;
      return `insured: total ${i3.data.total} insurer ${i3.data.insurance} patient ${i3.data.due}; expired: owes ${i4.data.due}`;
    });

    await u.step('P15-09', 'Admit Layla to bed A1: Admitted, bed Occupied, IPD visit opened; occupied bed, double admission, no bed, maintenance bed refused; bed status cannot be forced', async () => {
      ok(S.p2 && S.p3, 'depends on P15-03');
      refused(await c.post('/api/hospital/admissions', { patient: S.p2.code, doctor: DR }), 'no bed', [400]);
      refused(await c.post('/api/hospital/admissions', { patient: 'MRN-NOPE', bed: B1, doctor: DR }), 'unknown patient', [400]);
      const adm = must(await c.post('/api/hospital/admissions', { patient: S.p2.code, bed: B1, doctor: DR, reason: 'Pneumonia ' + K }), 'admit');
      eq(adm.status, 'Admitted', 'status'); ok(/^ADM-/.test(adm.code), 'code'); eq(adm.data.ward, W1, 'ward'); eq(adm.data.dailyRate, 350, 'daily rate'); S.adm = adm;
      let b = await bed(B1); eq(b.status, 'Occupied', 'bed after admit'); eq(b.data.patient, S.p2.code, 'patient on the bed');
      refused(await c.post('/api/hospital/admissions', { patient: S.p3.code, bed: B1, doctor: DR }), 'occupied bed', [409]);
      refused(await c.post('/api/hospital/admissions', { patient: S.p2.code, bed: B2, doctor: DR }), 'already admitted', [400]);
      must(await c.put(`/api/hospital/records/bed/${b.id}`, { id: b.id, kind: 'bed', code: B1, status: 'Available', parent: W1, data: b.data }), 'try to free the bed'); eq((await bed(B1)).status, 'Occupied', 'occupied bed cannot be set Available by hand');
      refused(await c.del(`/api/hospital/records/bed/${b.id}`), 'delete occupied bed', [400]);
      const b3 = await bed(B3); must(await c.put(`/api/hospital/records/bed/${b3.id}`, { id: b3.id, kind: 'bed', code: B3, status: 'Maintenance', parent: W1, data: b3.data }), 'maintenance'); eq((await bed(B3)).status, 'Maintenance', 'maintenance');
      refused(await c.post('/api/hospital/admissions', { patient: S.p3.code, bed: B3, doctor: DR }), 'maintenance bed', [409]);
      const vs = (await list('visit', `?parent=${S.p2.code}`)); ok(vs.length === 1 && vs[0].data.type === 'IPD' && vs[0].status === 'Open', 'IPD visit opened with the admission'); S.vIpd = vs[0];
      return adm.code + ' in ' + B1;
    });

    await u.step('P15-10', 'Transfer Layla to ICU bed B1: old bed free, new bed Occupied, rate 800, transfer history; occupied target and a non-admitted patient refused', async () => {
      ok(S.adm, 'depends on P15-09');
      refused(await c.post(`/api/hospital/admissions/${S.adm.id}/transfer`, { bed: B1 }), 'own occupied bed', [409]);
      refused(await c.post(`/api/hospital/admissions/${S.adm.id}/transfer`, { bed: B3 }), 'maintenance bed', [409]);
      refused(await c.post(`/api/hospital/admissions/${S.adm.id}/transfer`, { bed: 'NOPE-' + K }), 'unknown bed', [400]);
      const t = must(await c.post(`/api/hospital/admissions/${S.adm.id}/transfer`, { bed: B4 }), 'transfer');
      eq(t.data.bed, B4, 'bed'); eq(t.data.ward, W2, 'ward'); eq(t.data.dailyRate, 800, 'new rate'); eq(t.data.transfers.length, 1, 'history'); eq(t.data.transfers[0].rate, 350, 'old rate kept'); eq(t.data.transfers[0].from, B1, 'from bed');
      eq((await bed(B1)).status, 'Available', 'old bed'); eq((await bed(B4)).status, 'Occupied', 'new bed');
      return B1 + ' -> ' + B4;
    });

    await u.step('P15-11', 'Inpatient medicine: PARA x20 prescribed and dispensed from stock 200 -> 180; drug line 6.00; invoice follows', async () => {
      ok(S.vIpd, 'depends on P15-09');
      const rx = must(await c.post(`/api/hospital/visits/${S.vIpd.id}/prescriptions`, { items: [{ drug: PARA, dose: '500 mg', frequency: 'three times a day', days: 7, qty: 20 }] }), 'prescribe');
      const d = must(await c.post(`/api/hospital/prescriptions/${rx.id}/dispense`, {}), 'dispense'); eq(d.status, 'Dispensed', 'status');
      eq((await drug(PARA)).data.stock, 180, 'PARA stock');
      const inv = await invOf(S.vIpd.code); ok(inv, 'invoice exists for the inpatient visit'); eq(inv.data.lines.find(l => l.type === 'drug').amount, 6, 'drug line');
      ok(!inv.data.lines.some(l => l.type === 'consult'), 'an inpatient visit has no consultation line');
      return 'PARA 20 x 0.30 = 6.00';
    });

    await u.step('P15-12', 'Discharge: closing the visit while admitted and a discharge without summary are refused; discharge frees the bed; discharged twice refused', async () => {
      ok(S.adm && S.vIpd, 'depends on P15-09');
      must(await dx(S.vIpd.id), 'diagnosis');
      refused(await c.post(`/api/hospital/visits/${S.vIpd.id}/close`, {}), 'close while admitted', [400]);
      refused(await c.post(`/api/hospital/admissions/${S.adm.id}/discharge`, { summary: 'ok' }), 'summary too short', [400]);
      const summary = 'Recovered well, oral antibiotics, review in 1 week';
      const d = must(await c.post(`/api/hospital/admissions/${S.adm.id}/discharge`, { summary, outcome: 'Recovered' }), 'discharge');
      eq(d.status, 'Discharged', 'status'); eq(d.data.summary, summary, 'summary'); eq(d.data.days, 1, 'bed days (every started day counts, minimum one)'); ok(d.data.dischargedAt, 'time');
      eq((await bed(B4)).status, 'Available', 'bed after discharge');
      refused(await c.post(`/api/hospital/admissions/${S.adm.id}/discharge`, { summary }), 'discharge twice', [400]);
      refused(await c.post(`/api/hospital/admissions/${S.adm.id}/transfer`, { bed: B2 }), 'transfer after discharge', [400]);
      return 'discharged, bed free';
    });

    await u.step('P15-13', 'Inpatient invoice: bed A 1 day x 350 + ICU 1 day x 800 + medicine 6.00 = 1,156.00 (no consultation)', async () => {
      ok(S.vIpd, 'depends on P15-12');
      const cl = must(await c.post(`/api/hospital/visits/${S.vIpd.id}/close`, {}), 'close'); eq(cl.visit.status, 'Closed', 'closed');
      const inv = cl.invoice; const lines = inv.data.lines.map(l => `${l.type} ${l.amount}`).join(', ');
      const beds = inv.data.lines.filter(l => l.type === 'bed'); eq(beds.length, 2, 'bed lines: ' + lines); eq(beds.find(l => l.desc.includes(B1)).amount, 350, 'first bed, 1 day at the general rate'); eq(beds.find(l => l.desc.includes(B4)).amount, 800, 'ICU bed, 1 day');
      eq(inv.data.gross, 1156, 'gross: ' + lines); eq(inv.data.total, r2(num(inv.data.gross) + num(inv.data.tax)), 'total');
      S.inv2 = inv; return inv.code + ' [' + lines + ']';
    });

    await u.step('P15-14', 'Pay inpatient invoice: 500 card = Partial, then the balance by transfer = Paid; payments recorded with method and reference', async () => {
      ok(S.inv2, 'depends on P15-13');
      const due = num(S.inv2.data.due);
      const a = must(await pay(S.inv2, 500, 'card', { ref: 'POS-' + K }), '500 card'); eq(a.status, 'Partial', 'status'); eq(a.data.balance, r2(due - 500), 'balance');
      refused(await pay(S.inv2, r2(due - 500) + 0.01, 'cash'), 'one cent over', [400]);
      const b = must(await pay(S.inv2, r2(due - 500), 'transfer', { ref: 'TRF-' + K }), 'balance'); eq(b.status, 'Paid', 'status');
      ok(b.data.payments.map(p => p.method).join() === 'card,transfer', 'methods ' + b.data.payments.map(p => p.method)); ok(b.data.payments[0].ref === 'POS-' + K, 'reference'); eq(b.data.paid, due, 'paid');
      return `due ${due} paid in 2`;
    });

    await u.step('P15-15', 'Beds and wards upkeep: free bed back from maintenance, delete a free bed; ward with beds cannot be deleted; empty ward can', async () => {
      const b3 = await bed(B3); ok(b3, 'depends on P15-09');
      must(await c.put(`/api/hospital/records/bed/${b3.id}`, { id: b3.id, kind: 'bed', code: B3, status: 'Available', parent: W1, data: b3.data }), 'back to Available'); eq((await bed(B3)).status, 'Available', 'available again');
      must(await c.del(`/api/hospital/records/bed/${b3.id}`), 'delete free bed'); ok(!(await bed(B3)), 'bed still listed');
      const w1 = (await list('ward')).find(w => w.code === W1); refused(await c.del(`/api/hospital/records/ward/${w1.id}`), 'ward with beds', [400]);
      const tmp = await post('ward', `WT-${K}`, { name: 'Temp ' + K, rate: 1 }); must(await c.del(`/api/hospital/records/ward/${tmp.id}`), 'delete empty ward');
      ok(!(await list('ward')).some(w => w.code === `WT-${K}`), 'ward still listed');
      return 'upkeep ok';
    });

    await u.step('P15-16', 'Overview: collected >= my payments, outstanding >= what Expired still owes, beds consistent, low stock lists paracetamol (180 <= 200), pending counters', async () => {
      ok(S.inv1 && S.inv2 && S.inv4, 'depends on P15-06/13/08');
      const mine = (await list('invoice')).filter(i => [S.p1, S.p2, S.p3, S.p4].some(p => p.code === i.ref));
      eq(mine.length, 4, 'my invoices (one per visit)');
      const collected = r2(mine.reduce((s, i) => s + num(i.data.paid), 0)), owed = r2(mine.reduce((s, i) => s + Math.max(0, num(i.data.due) - num(i.data.paid)), 0));
      eq(owed, num(S.inv4.data.due), 'only the Expired patient still owes'); ok(collected > 0, 'collected');
      const d = must(await c.get(`/api/hospital/dashboard?today=${new Date().toISOString().slice(0, 10)}&tz=0`), 'dashboard');
      ok(d.revenueToday >= collected - 0.005, `revenueToday ${d.revenueToday} < my collected ${collected}`); ok(d.revenueWeek >= d.revenueToday - 0.005, 'week >= today');
      ok(d.outstanding >= owed - 0.005, `outstanding ${d.outstanding} < ${owed}`);
      ok(d.beds.total >= 2 && d.beds.total === d.beds.occupied + d.beds.available, 'beds consistent: ' + JSON.stringify(d.beds));
      ok(d.beds.occupancyPct >= 0 && d.beds.occupancyPct <= 100, 'occupancy');
      ok((d.lowStock || []).some(x => x.code === PARA && num(x.stock) === 180), 'low stock should list ' + PARA);
      ok(Number.isFinite(d.admitted) && Number.isFinite(d.pendingRx) && Number.isFinite(d.openVisits), 'counters');
      return `collected ${collected}, still owed ${owed}; beds ${d.beds.occupied}/${d.beds.total}`;
    });
  },
};
