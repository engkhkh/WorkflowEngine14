// Hospital clinical: doctor's office. Own doctor, tests, medicines, patients; appointments, check-in, vitals, diagnosis, lab (critical / amend), prescriptions with allergy and interaction blocks.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const body = (kind, code, data, extra = {}) => ({ id: 'new', kind, code, data, ...extra });

module.exports = {
  id: 'hospital-clinical',
  title: 'Hospital doctor (clinical)',
  modules: ['hos'],
  role: 'doctor',
  perms: ['hos.*'],
  probe: { path: '/api/hospital/records/labrequest', perm: 'hos.lab.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, TODAY = u.ws.today;
    const DR = `DR-${K}`, GLU = `GLU-${K}`, HGB = `HGB-${K}`, SRV = `SRV-${K}`, AMOX = `AMOX-${K}`, PARA = `PARA-${K}`, ASA = `ASA-${K}`, WARF = `WARF-${K}`;
    const list = async (kind, qs = '') => must(await c.get(`/api/hospital/records/${kind}${qs}`), 'list ' + kind);
    const post = async (kind, code, data, extra) => must(await c.post(`/api/hospital/records/${kind}`, body(kind, code, data, extra)), `create ${kind} ${code}`);
    const day = addDays(TODAY, 4);
    const book = (p, t, extra = {}) => c.post('/api/hospital/appointments', { patient: p.code, doctor: DR, start: `${day}T${t}`, reason: 'Check-up ' + K, ...extra });
    const lab = (id, o) => c.post(`/api/hospital/labrequests/${id}/result`, o);

    await u.step('P14-01', 'Setup: doctor (fee 200, 09:00-13:00, 15 min), service, 2 lab tests with ranges, 4 medicines; duplicate codes refused', async () => {
      await post('doctor', DR, { name: `Dr. Clinic ${K}`, department: 'GEN', specialty: 'General Medicine', fee: 200, days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '13:00', slot: 15 });
      refused(await c.post('/api/hospital/records/doctor', body('doctor', DR, { name: 'dup' })), 'duplicate doctor', [409]);
      refused(await c.post('/api/hospital/records/doctor', body('doctor', '', { name: 'no code' })), 'doctor without code', [400]);
      await post('service', SRV, { name: `Dressing ${K}`, category: 'procedure', price: 60 });
      await post('labtest', GLU, { name: `Glucose ${K}`, unit: 'mg/dL', low: 70, high: 100, critLow: 50, critHigh: 400, price: 50, sample: 'Blood' });
      await post('labtest', HGB, { name: `Hemoglobin ${K}`, unit: 'g/dL', low: 12, high: 17, critLow: 7, critHigh: 20, price: 30, sample: 'Blood' });
      await post('drug', AMOX, { name: `Amoxicillin ${K}`, class: 'penicillin', strength: '500 mg', form: 'Capsule', price: 1.2, stock: 100, reorder: 10 });
      await post('drug', PARA, { name: `Paracetamol ${K}`, class: 'analgesic', strength: '500 mg', form: 'Tablet', price: 0.3, stock: 200, reorder: 20 });
      await post('drug', WARF, { name: `Warfarin ${K}`, class: 'anticoagulant', strength: '5 mg', form: 'Tablet', price: 1.2, stock: 100, reorder: 10, interactsWith: [`Aspirin ${K}`] });
      await post('drug', ASA, { name: `Aspirin ${K}`, class: 'antiplatelet', strength: '100 mg', form: 'Tablet', price: 0.3, stock: 100, reorder: 10, interactsWith: [`Warfarin ${K}`] });
      const doc = (await list('doctor')).find(d => d.code === DR); ok(doc, 'doctor not listed'); eq(doc.data.fee, 200, 'fee');
      const t = (await list('labtest')).find(x => x.code === GLU); eq(t.data.high, 100, 'GLU high'); eq(t.data.critHigh, 400, 'GLU critical high');
      eq((await list('drug')).filter(d => d.code.endsWith(K)).length, 4, 'medicines');
      return 'doctor ' + DR + ', 2 tests, 4 medicines';
    });

    await u.step('P14-02', 'Register patients A (penicillin allergy), B (diabetes), C; file numbers MRN-; duplicate national id refused; no name refused', async () => {
      const reg = (name, nid, allergies, conditions) => c.post('/api/hospital/records/patient', body('patient', null, { name: `${name} ${K}`, sex: 'F', dob: '1990-05-05', phone: '+96650' + u.tag + '00', nationalId: nid, allergies, conditions }));
      const a = must(await reg('Patient A', `NID-${K}-A`, ['penicillin'], []), 'A');
      const b = must(await reg('Patient B', `NID-${K}-B`, [], ['type 2 diabetes']), 'B');
      const cc = must(await reg('Patient C', `NID-${K}-C`, [], []), 'C');
      for (const p of [a, b, cc]) ok(/^MRN-\d{6}$/.test(p.code), 'file number ' + p.code);
      ok(new Set([a.code, b.code, cc.code]).size === 3, 'file numbers must differ');
      const dup = refused(await reg('Patient A', `NID-${K}-A`, ['penicillin'], []), 'duplicate patient', [409]);
      ok(/already registered/i.test(dup.text) && dup.data.code === a.code, 'duplicate should point to ' + a.code + ': ' + dup.text);
      refused(await c.post('/api/hospital/records/patient', body('patient', null, { name: '   ', nationalId: `NID-${K}-Z` })), 'patient without name', [400]);
      refused(await c.del(`/api/hospital/records/patient/${a.id}`), 'patients are never deleted', [404]);
      S.A = a; S.B = b; S.C = cc; return [a.code, b.code, cc.code].join(', ');
    });

    await u.step('P14-03', 'Patient file: edit phone is audited, search by national id finds one, file shows allergies and audit trail', async () => {
      ok(S.A, 'depends on P14-02');
      const up = must(await c.put(`/api/hospital/records/patient/${S.A.id}`, body('patient', S.A.code, { ...S.A.data, phone: '+966500000999' })), 'update patient'); eq(up.data.phone, '+966500000999', 'new phone');
      const hits = await list('patient', `?q=${encodeURIComponent('NID-' + K + '-A')}`); eq(hits.length, 1, 'search by national id');
      const f = must(await c.get(`/api/hospital/patients/${S.A.code}/file`), 'patient file');
      eq(f.patient.code, S.A.code, 'file patient'); ok(f.canClinical === true, 'clinical access'); ok(f.patient.data.allergies.includes('penicillin'), 'allergy on the file');
      ok(f.audit.some(a => /registered/.test(a.data.action)) && f.audit.some(a => /updated/.test(a.data.action)), 'audit trail lacks registered/updated');
      refused(await c.get('/api/hospital/patients/NOPE-' + K + '/file'), 'unknown patient file', [404]);
      return f.audit.length + ' audit entries';
    });

    await u.step('P14-04', 'Appointments: A 09:00 booked, B 09:00 clashes (409), B 09:15 accepted; outside hours, past, unknown patient refused', async () => {
      ok(S.A && S.B, 'depends on P14-02');
      const m = must(await book(S.A, '09:00'), 'book A'); ok(m.status === 'Booked' && /^APT-/.test(m.code), 'booked ' + m.status);
      const clash = refused(await book(S.B, '09:00'), 'B at 09:00', [409]); ok(/already has an appointment/i.test(clash.text), 'conflict message: ' + clash.text);
      const b = must(await book(S.B, '09:15'), 'book B 09:15');
      refused(await book(S.B, '15:00'), 'outside doctor hours', [400]);
      refused(await c.post('/api/hospital/appointments', { patient: S.B.code, doctor: DR, start: `${addDays(TODAY, -3)}T09:30`, reason: 'past' }), 'in the past', [400]);
      refused(await c.post('/api/hospital/appointments', { patient: 'MRN-NOPE', doctor: DR, start: `${day}T10:00` }), 'unknown patient', [400]);
      refused(await c.post('/api/hospital/appointments', { patient: S.B.code, doctor: 'DR-NOPE-' + K, start: `${day}T10:00` }), 'unknown doctor', [400]);
      refused(await book(S.B, '09:20'), 'patient B already has 09:15-09:30', [409]);
      S.mA = m; S.mB = b;
      eq((await list('appointment', `?ref=${day}`)).filter(x => x.parent === DR && x.status === 'Booked').length, 2, 'booked that day');
      return `${m.code}, ${b.code}`;
    });

    await u.step('P14-05', 'Cancel and no-show: C booked 10:00 then cancelled; a cancelled one cannot be changed or checked in; slot is free again', async () => {
      ok(S.C, 'depends on P14-02');
      const cc = must(await book(S.C, '10:00'), 'book C');
      const x = must(await c.post(`/api/hospital/appointments/${cc.id}/status`, { status: 'Cancelled', note: 'patient called' }), 'cancel'); eq(x.status, 'Cancelled', 'status');
      refused(await c.post(`/api/hospital/appointments/${cc.id}/status`, { status: 'CheckedIn', today: TODAY }), 'check in cancelled', [400]);
      refused(await c.post(`/api/hospital/appointments/${cc.id}/status`, { status: 'NoShow' }), 'change after cancel', [400]);
      const again = must(await book(S.C, '10:00'), 'slot free again');
      const ns = must(await c.post(`/api/hospital/appointments/${again.id}/status`, { status: 'NoShow' }), 'no show'); eq(ns.status, 'NoShow', 'no show status');
      refused(await c.post(`/api/hospital/appointments/${again.id}/status`, { status: 'Weird' }), 'unknown status', [400, 404]);
      return 'cancelled and no-show';
    });

    await u.step('P14-06', 'Check in A and B: visits Open linked to the appointment, queue 1 and 2, appointment CheckedIn; second check-in refused; cancel after check-in refused', async () => {
      ok(S.mA && S.mB, 'depends on P14-04');
      const ca = must(await c.post(`/api/hospital/appointments/${S.mA.id}/status`, { status: 'CheckedIn', today: TODAY }), 'check in A');
      eq(ca.appointment.status, 'CheckedIn', 'appointment'); ok(ca.visit.status === 'Open', 'visit Open'); eq(ca.visit.data.appointment, S.mA.code, 'visit link'); eq(ca.visit.data.queue, 1, 'queue of A');
      const cb = must(await c.post(`/api/hospital/appointments/${S.mB.id}/status`, { status: 'CheckedIn', today: TODAY }), 'check in B'); eq(cb.visit.data.queue, 2, 'queue of B');
      refused(await c.post(`/api/hospital/appointments/${S.mA.id}/status`, { status: 'CheckedIn', today: TODAY }), 'second check-in', [400]);
      refused(await c.post(`/api/hospital/appointments/${S.mA.id}/status`, { status: 'Cancelled' }), 'cancel after check-in', [400]);
      refused(await c.post('/api/hospital/visits', { patient: S.A.code, doctor: DR, type: 'OPD', today: TODAY }), 'second open visit with the same doctor', [400]);
      S.vA = ca.visit; S.vB = cb.visit; return `${ca.visit.code}, ${cb.visit.code}`;
    });

    await u.step('P14-07', 'Vitals and diagnosis: implausible temperature 370 and SpO2 140 refused; vitals 120/80 and J02 saved; service added at list price 60', async () => {
      ok(S.vA && S.vB, 'depends on P14-06');
      refused(await c.put(`/api/hospital/visits/${S.vA.id}`, { vitals: { temp: 370 } }), 'temperature 370', [400]);
      refused(await c.put(`/api/hospital/visits/${S.vA.id}`, { vitals: { spo2: 140 } }), 'spo2 140', [400]);
      must(await c.put(`/api/hospital/visits/${S.vA.id}`, { complaint: 'Sore throat', vitals: { sys: 120, dia: 80, temp: 37.0, pulse: 72, spo2: 98, weight: 62, height: 165 }, diagnoses: [{ code: 'J02', name: 'Pharyngitis' }], notes: { s: 'throat pain', o: 'red', a: 'pharyngitis', p: 'rest' } }), 'update A');
      must(await c.put(`/api/hospital/visits/${S.vB.id}`, { complaint: 'Thirst', vitals: { sys: 130, dia: 85, temp: 36.8 }, diagnoses: [{ code: 'E11', name: 'Type 2 diabetes mellitus' }] }), 'update B');
      const v = (await list('visit', `?parent=${S.A.code}`)).find(x => x.id === S.vA.id);
      eq(v.data.vitals.sys, 120, 'systolic'); eq(v.data.vitals.temp, 37, 'temp'); eq(v.data.diagnoses[0].code, 'J02', 'diagnosis'); ok(v.data.vitals.by, 'vitals author');
      const sv = must(await c.post(`/api/hospital/visits/${S.vA.id}/services`, { service: SRV, qty: 1 }), 'add service'); eq(sv.data.services[0].price, 60, 'service price'); eq(sv.data.services.length, 1, 'services');
      refused(await c.post(`/api/hospital/visits/${S.vA.id}/services`, { service: 'NOPE-' + K }), 'unknown service', [400]);
      return 'vitals + J02 + service 60';
    });

    await u.step('P14-08', 'Lab for A: glucose 88 = Normal, hemoglobin 5 = Critical low; duplicate order skipped; empty/unknown refused', async () => {
      ok(S.vA, 'depends on P14-06');
      refused(await c.post(`/api/hospital/visits/${S.vA.id}/labs`, { tests: [] }), 'no tests', [400]);
      refused(await c.post(`/api/hospital/visits/${S.vA.id}/labs`, { tests: ['NOPE-' + K] }), 'unknown test', [400]);
      const o1 = must(await c.post(`/api/hospital/visits/${S.vA.id}/labs`, { tests: [GLU, HGB] }), 'order'); eq(o1.length, 2, 'two requests'); ok(o1.every(l => l.status === 'Ordered'), 'Ordered');
      const o2 = must(await c.post(`/api/hospital/visits/${S.vA.id}/labs`, { tests: [GLU] }), 'order again'); eq(o2.length, 0, 'duplicate while waiting is skipped');
      const g = o1.find(l => l.data.test === GLU), h = o1.find(l => l.data.test === HGB);
      refused(await lab(g.id, { value: '  ' }), 'empty result', [400]);
      const rg = must(await lab(g.id, { value: '88' }), 'glucose'); eq(rg.data.flag, 'Normal', 'flag 88'); eq(rg.status, 'Resulted', 'status');
      const rh = must(await lab(h.id, { value: '5' }), 'hemoglobin'); eq(rh.data.flag, 'Critical low', 'flag 5');
      S.labG = g; S.labH = h; return 'Normal / Critical low';
    });

    await u.step('P14-09', 'Lab for B: glucose 450 = Critical high, 130 = High/Low bands, release is final; amend 455 keeps 450 in history', async () => {
      ok(S.vB, 'depends on P14-06');
      const o = must(await c.post(`/api/hospital/visits/${S.vB.id}/labs`, { tests: [GLU], urgent: true }), 'order'); const id = o[0].id; ok(o[0].data.urgent === true, 'urgent flag');
      const r1 = must(await lab(id, { value: '450' }), '450'); eq(r1.data.flag, 'Critical high', 'flag 450');
      refused(await lab(id, { value: '455' }), 'edit a released result without amend', [400]);
      const am = must(await lab(id, { value: '120', amend: true, note: 'repeat sample' }), 'amend'); eq(am.data.value, '120', 'amended'); eq(am.data.flag, 'High', 'flag 120 (above 100, below 400)');
      ok(am.data.history && am.data.history.length === 1 && am.data.history[0].value === '450' && am.data.history[0].flag === 'Critical high', 'history keeps 450 Critical high');
      const am2 = must(await lab(id, { value: '60', amend: true }), 'amend low'); eq(am2.data.flag, 'Low', 'flag 60'); eq(am2.data.history.length, 2, 'two history entries');
      const am3 = must(await lab(id, { value: '45', amend: true }), 'amend critical low'); eq(am3.data.flag, 'Critical low', 'flag 45');
      const pend = must(await c.get(`/api/hospital/records/labrequest?parent=${S.vB.code}`), 'labs of visit'); eq(pend.length, 1, 'one request');
      return '450 -> 120 -> 60 -> 45, history 3';
    });

    await u.step('P14-10', 'Allergy block: A + amoxicillin refused (409 ALLERGY) until a reason of 5+ characters; reason saved on the prescription', async () => {
      ok(S.vA, 'depends on P14-06');
      const item = { drug: AMOX, dose: '500 mg', frequency: '3 times a day', days: 5, qty: 15 };
      const rx = `/api/hospital/visits/${S.vA.id}/prescriptions`;
      const blocked = refused(await c.post(rx, { items: [item] }), 'allergy', [409]);
      ok((blocked.data.warnings || []).some(w => /ALLERGY/.test(w)), 'ALLERGY warning expected: ' + blocked.text);
      refused(await c.post(rx, { items: [item], overrideReason: 'ok' }), 'reason too short', [409]);
      const reason = 'Culture negative, tolerated before';
      const p = must(await c.post(rx, { items: [item], overrideReason: reason }), 'with reason'); eq(p.data.overrideReason, reason, 'reason saved'); ok(p.data.warnings.length > 0, 'warnings kept'); eq(p.status, 'Pending', 'status');
      eq(p.data.items[0].dispensed, 0, 'nothing dispensed yet'); S.rxA = p; return p.code;
    });

    await u.step('P14-11', 'Prescription rules: no items, zero qty, missing dose, unknown medicine refused; paracetamol clean; Pending can be cancelled once', async () => {
      ok(S.vA, 'depends on P14-06');
      const rx = `/api/hospital/visits/${S.vA.id}/prescriptions`;
      refused(await c.post(rx, { items: [] }), 'no items', [400]);
      refused(await c.post(rx, { items: [{ drug: PARA, dose: '1', frequency: 'daily', qty: 0 }] }), 'zero qty', [400]);
      refused(await c.post(rx, { items: [{ drug: PARA, qty: 5 }] }), 'no dose/frequency', [400]);
      refused(await c.post(rx, { items: [{ drug: 'NOPE-' + K, dose: '1', frequency: 'daily', qty: 5 }] }), 'unknown medicine', [400]);
      const p = must(await c.post(rx, { items: [{ drug: PARA, dose: '500 mg', frequency: 'twice a day', days: 5, qty: 10 }] }), 'paracetamol'); eq(p.data.warnings.length, 0, 'no warning');
      const x = must(await c.post(`/api/hospital/prescriptions/${p.id}/cancel`, {}), 'cancel'); eq(x.status, 'Cancelled', 'cancelled');
      refused(await c.post(`/api/hospital/prescriptions/${p.id}/cancel`, {}), 'cancel twice', [400]);
      refused(await c.post(`/api/hospital/prescriptions/${p.id}/dispense`, {}), 'dispense cancelled', [400]);
      return 'ok';
    });

    await u.step('P14-12', 'Interaction block: warfarin + aspirin together (409 INTERACTION), then aspirin against active warfarin; reason lets it through', async () => {
      ok(S.vB, 'depends on P14-06');
      const rx = `/api/hospital/visits/${S.vB.id}/prescriptions`;
      const w = { drug: WARF, dose: '5 mg', frequency: 'daily', days: 30, qty: 30 }, a = { drug: ASA, dose: '100 mg', frequency: 'daily', days: 30, qty: 30 };
      const both = refused(await c.post(rx, { items: [w, a] }), 'both together', [409]); ok((both.data.warnings || []).some(x => /INTERACTION/.test(x)), 'INTERACTION expected: ' + both.text);
      must(await c.post(rx, { items: [w] }), 'warfarin alone');
      const second = refused(await c.post(rx, { items: [a] }), 'aspirin vs active warfarin', [409]); ok((second.data.warnings || []).some(x => /INTERACTION/.test(x)), 'INTERACTION vs active: ' + second.text);
      const ok2 = must(await c.post(rx, { items: [a], overrideReason: 'Cardiology agreed, INR monitored' }), 'with reason'); ok(ok2.data.warnings.length > 0, 'warning kept');
      return 'interaction blocked and overridden';
    });

    await u.step('P14-13', 'Close visits: B closes with diagnosis; A closes; invoice A = consult 200 + glucose 50 + hemoglobin 30 + dressing 60 = 340; closed visit refuses changes', async () => {
      ok(S.vA && S.vB, 'depends on P14-06');
      const nodx = must(await c.post('/api/hospital/visits', { patient: S.C.code, doctor: DR, type: 'OPD', today: TODAY, complaint: 'no diagnosis' }), 'visit for C');
      refused(await c.post(`/api/hospital/visits/${nodx.id}/close`, {}), 'close without diagnosis', [400]);
      must(await c.put(`/api/hospital/visits/${nodx.id}`, { diagnoses: [{ code: 'Z00', name: 'Check' }] }), 'diagnosis'); must(await c.post(`/api/hospital/visits/${nodx.id}/close`, {}), 'close C');
      const a = must(await c.post(`/api/hospital/visits/${S.vA.id}/close`, {}), 'close A'); eq(a.visit.status, 'Closed', 'A closed');
      must(await c.post(`/api/hospital/visits/${S.vB.id}/close`, {}), 'close B');
      const inv = a.invoice; const lines = inv.data.lines.map(l => `${l.type} ${l.amount}`).join(', ');
      eq(inv.data.gross, 340, 'gross: ' + lines); eq(inv.data.total, num(inv.data.gross) + num(inv.data.tax), 'total = gross + tax'); ok(inv.status === 'Unpaid', 'invoice status ' + inv.status);
      eq(inv.data.lines.filter(l => l.type === 'lab').length, 2, 'lab lines'); eq(inv.data.lines.find(l => l.type === 'consult').amount, 200, 'consultation');
      refused(await c.put(`/api/hospital/visits/${S.vA.id}`, { complaint: 'late' }), 'edit closed visit', [400]);
      refused(await c.post(`/api/hospital/visits/${S.vA.id}/prescriptions`, { items: [{ drug: PARA, dose: '1', frequency: 'd', qty: 1 }] }), 'prescribe in closed visit', [400]);
      refused(await c.post(`/api/hospital/visits/${S.vA.id}/labs`, { tests: [HGB] }), 'lab in closed visit', [400]);
      refused(await c.post(`/api/hospital/visits/${S.vA.id}/close`, {}), 'close twice', [400]);
      ok((await list('appointment', `?ref=${day}`)).find(x => x.id === S.mA.id).status === 'Completed', 'appointment Completed after closing the visit');
      return 'invoice ' + inv.code + ' gross 340 [' + lines + ']';
    });

    await u.step('P14-14', 'Patient file after care: visits, prescriptions, labs, invoices listed; clinical list for the doctor; dashboard counts', async () => {
      ok(S.A && S.vA, 'depends on P14-02/06');
      const f = must(await c.get(`/api/hospital/patients/${S.A.code}/file`), 'file');
      eq(f.visits.length, 1, 'visits of A'); ok(f.prescriptions.length >= 2, 'prescriptions of A ' + f.prescriptions.length); eq(f.labs.length, 2, 'labs of A'); eq(f.invoices.length, 1, 'invoices of A'); ok(f.appointments.length >= 1, 'appointments of A');
      const d = must(await c.get(`/api/hospital/dashboard?today=${TODAY}&tz=0`), 'dashboard');
      ok(d.patients >= 3, 'patients ' + d.patients); ok(Array.isArray(d.days) && d.days.length === 7, 'week days'); ok(d.appointmentsToday && Number.isFinite(d.appointmentsToday.total), 'appointments today block');
      ok((d.topDiagnoses || []).length >= 1, 'top diagnoses'); ok(Number.isFinite(d.pendingLabs) && Number.isFinite(d.pendingRx), 'pending counters');
      return `patients ${d.patients}, open visits ${d.openVisits}`;
    });
  },
};
