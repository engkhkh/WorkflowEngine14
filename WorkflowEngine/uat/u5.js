// User 5 - Dr. Sara Al-Otaibi (doctor + hos.*, hr.*, pay.run.manage, pay.setup, pay.payslips.view, mus.view, cal.*)
// Hospital (api/hospital), HR (api/hr), Payroll run (api/erp/pay), Calendar (api/calendar), Muslim (browser only).
const { must, refused, eq, ok, step, manual, addDays } = require('./lib');

const S_KEY = 'sara';                                   // private scratch inside ctx.S
const utcDay = () => new Date().toISOString().slice(0, 10);
const need = (v, dep) => { if (!v) throw new Error(`depends on ${dep}, which did not complete`); return v; };
const num = x => Number(x);

// ------------------------------------------------------------------ small API helpers
const hosBody = (kind, code, data, extra = {}) => ({ id: 'new', kind, code, data, ...extra });
const hosList = async (c, kind, qs = '') => must(await c.get(`/api/hospital/records/${kind}${qs}`), `list ${kind}`);
const hosOne = async (c, kind, id) => must(await c.get(`/api/hospital/records/${kind}/${encodeURIComponent(id)}`), `get ${kind} ${id}`);
const hr = {
  rec: (kind, o) => ({ id: 'new', kind, ...o }),
  list: async (c, kind) => must(await c.get(`/api/hr/records/${kind}`), `hr list ${kind}`),
  emps: async c => must(await c.get('/api/hr/employees'), 'hr employees'),
};
const erpBody = (kind, o) => ({ id: 'new', module: 'pay', kind, ...o });
/** Read a payroll list as Sara; Sara has no pay.view / pay.self in the doc's privilege list, so fall back to Khalid (admin) and say so. */
async function payRead(ctx, path, note) {
  const r = await ctx.U.sara.get(path);
  if (r.ok) return r.data;
  if (r.status === 403 && ctx.U.khalid) { if (note) note.push('Sara has no pay.view/pay.self -> read via Khalid'); return must(await ctx.U.khalid.get(path), path); }
  return must(r, path);
}
const S = ctx => (ctx.S[S_KEY] = ctx.S[S_KEY] || {});
const P = ctx => (ctx.S.hos = ctx.S.hos || {});         // hospital scratch: patients, appointments, visits, invoices

// the five staff: [key, empNo, unit, basic, manager]
const STAFF = [
  ['sara',   'E001', 'MED', 22000, '',     'Medical Director'],
  ['noura',  'E002', 'FIN', 20000, 'E001', 'Finance Controller'],
  ['khalid', 'E003', 'IT',  18000, 'E001', 'IT and Systems Admin'],
  ['faisal', 'E004', 'SCM', 16000, 'E001', 'Supply Chain and Plant Manager'],
  ['reem',   'E005', 'COM', 15000, 'E001', 'Commercial and Projects Manager'],
];
const EMPNO = Object.fromEntries(STAFF.map(s => [s[0], s[1]]));
// expected October slips (basic*1.35 gross; GOSI = 9.75% of basic*1.25), bonus only for Faisal
const EXPECT = {
  E003: { gross: 24300, ded: 2193.75, net: 22106.25 },
  E002: { gross: 27000, ded: 2437.50, net: 24562.50 },
  E004: { gross: 22600, ded: 1950.00, net: 20650.00 },     // 21,600 + 1,000 bonus
  E005: { gross: 20250, ded: 1828.13, net: 18421.87 },
  E001: { gross: 29700, ded: 2681.25, net: 27018.75 },
};
const PERIOD = '2026-10';

// ==================================================================================== DAY 0
exports.day0 = async function (ctx) {
  const sara = ctx.U.sara;
  if (!sara) throw new Error('Sara is not signed in (bootstrap incomplete)');

  // ---------------- U5-01 hospital setup
  await step('U5-01', 'Hospital setup: doctor, ward + 6 beds, drugs, lab test, fees, pharmacy stock', async () => {
    const post = async (kind, code, data, extra) => must(await sara.post(`/api/hospital/records/${kind}`, hosBody(kind, code, data, extra)), `${kind} ${code}`);
    await post('setting', 'main', { name: 'Al-Noor Hospital', currency: 'SAR', taxName: '', taxPct: 0, paymentMethods: ['cash', 'card', 'transfer', 'other'], weekend: [5, 6] });
    await post('department', 'GEN', { name: 'General Medicine' });
    // fee 200 is the consultation fee the invoice takes from the doctor; slot 15 minutes from 09:00
    await post('doctor', 'DR-001', { name: 'Dr. Sara Al-Otaibi', department: 'GEN', specialty: 'General Medicine', fee: 200, days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '13:00', slot: 15 });
    await post('service', 'CONSULT', { name: 'Consultation', category: 'consult', price: 200 });
    // the bed charge of 350 per night is the daily rate of the ward
    await post('ward', 'W1', { name: 'W1 General', rate: 350 });
    for (let i = 1; i <= 6; i++) await post('bed', `W1-0${i}`, { label: `Bed ${i}` }, { parent: 'W1' });
    await post('drug', 'AMOX', { name: 'Amoxicillin', class: 'penicillin', strength: '500 mg', form: 'Capsule', price: 1.2, stock: 10, reorder: 5 });
    await post('drug', 'PARA', { name: 'Paracetamol', class: 'analgesic', strength: '500 mg', form: 'Tablet', price: 0.3, stock: 200, reorder: 20 });
    await post('drug', 'METF', { name: 'Metformin', class: 'antidiabetic', strength: '500 mg', form: 'Tablet', price: 0.4, stock: 200, reorder: 20 });
    await post('labtest', 'GLU', { name: 'Glucose', unit: 'mg/dL', low: 70, high: 100, critLow: 50, critHigh: 400, price: 50, sample: 'Blood' });

    const beds = await hosList(sara, 'bed');
    const w1 = beds.filter(b => b.parent === 'W1');
    eq(w1.length, 6, 'beds in W1');
    ok(w1.every(b => b.status === 'Available'), 'all six beds should be Available');
    const drugs = await hosList(sara, 'drug');
    const stock = c => num(drugs.find(d => d.code === c).data.stock);
    eq(stock('AMOX'), 10, 'AMOX stock'); eq(stock('PARA'), 200, 'PARA stock'); eq(stock('METF'), 200, 'METF stock');
    ok((await hosList(sara, 'labtest')).some(t => t.code === 'GLU' && num(t.data.low) === 70 && num(t.data.high) === 100), 'GLU range 70-100 missing');
    const dash = must(await sara.get(`/api/hospital/dashboard?today=${utcDay()}&tz=0`), 'dashboard');
    eq(dash.beds.total, 6, 'dashboard beds total'); eq(dash.beds.available, 6, 'dashboard beds available');
    return 'DR-001 fee 200, W1 rate 350, 6 beds free, AMOX 10 / PARA 200 / METF 200';
  });

  // ---------------- U5-12 HR org + import
  await step('U5-12', 'HR: 5 departments, import 5 staff from CSV, Sara on top with 4 reports', async () => {
    const units = [['MED', 'Medical'], ['FIN', 'Finance'], ['SCM', 'Supply Chain'], ['COM', 'Commercial'], ['IT', 'IT']];
    for (const [code, name] of units)
      must(await sara.post('/api/hr/records/unit', hr.rec('unit', { code, data: { name, nameAr: '', level: 'department', parent: '', manager: '' } })), 'unit ' + code);
    must(await sara.post('/api/hr/records/leavetype', hr.rec('leavetype', { code: 'ANNUAL', data: { name: 'Annual leave', nameAr: '', days: 21 } })), 'leave type ANNUAL');

    // the CSV the portal would read; the portal parses it in the browser and posts the mapped rows
    const head = 'empNo,fullName,email,unit,position,managerEmpNo,branch,company,basicSalary,username,hireDate,status';
    const brOf = { sara: 'RYD', noura: 'RYD', khalid: 'RYD', faisal: 'JED', reem: 'DMM' };
    const lines = STAFF.map(([k, no, unit, basic, mgr, pos]) =>
      [no, ctx.names[k].display, `${k}.${ctx.run}@example.com`, unit, pos, mgr, ctx.branch[brOf[k]] || '', ctx.company || '', basic, ctx.users[k] || ctx.username(k), '2024-01-01', 'Active'].join(','));
    const rows = [head, ...lines].map(l => l.split(','));
    const keys = rows[0];
    const payload = rows.slice(1).map((cells, i) => {
      const data = {}; keys.forEach((k, j) => { data[k] = k === 'basicSalary' ? Number(cells[j]) : (cells[j] === '' ? null : cells[j]); });
      return { row: i + 2, data };
    });
    const res = must(await sara.post('/api/hr/employees/import', { rows: payload, updateExisting: true }), 'import');
    eq(res.created, 5, 'created'); ok(!res.errors || res.errors.length === 0, 'import errors: ' + JSON.stringify(res.errors));

    const emps = await hr.emps(sara);
    eq(emps.length, 5, 'employee count');
    const unitOf = no => emps.find(e => e.empNo === no).unit;
    for (const [k, no, unit] of STAFF) eq(unitOf(no), unit, 'unit of ' + k);
    const bySalary = Object.fromEntries(emps.map(e => [e.empNo, num(e.basicSalary)]));
    for (const [k, no, , basic] of STAFF) eq(bySalary[no], basic, 'basic salary of ' + k);
    // org chart = manager links: Sara on top (no manager), four direct reports
    const tops = emps.filter(e => !e.managerEmpNo);
    eq(tops.length, 1, 'people without a manager'); eq(tops[0].empNo, 'E001', 'top of the org chart');
    eq(emps.filter(e => e.managerEmpNo === 'E001').length, 4, 'direct reports of Sara');
    // the portal user link used by self-service and payslips
    for (const [k, no] of STAFF) eq(emps.find(e => e.empNo === no).username, ctx.users[k], 'username link of ' + k);
    const sum = must(await sara.get('/api/hr/summary'), 'hr summary');
    eq(sum.total, 5, 'summary total'); eq(num(sum.monthlyPayroll), 91000, 'monthly basic payroll');
    return 'E001 Sara (top), E002 Noura, E003 Khalid, E004 Faisal, E005 Reem; basic total 91,000';
  });

  // ---------------- U5-13 payroll elements
  await step('U5-13', 'Payroll setup: Housing 25%, Transport 10%, GOSI employee deduction', async () => {
    const make = async (code, name, type, value) => must(await sara.post('/api/erp/pay/records/element', erpBody('element', { code, status: 'Active', data: { name, type, calc: 'pctBasic', value } })), 'element ' + code);
    await make('HOUSING', 'Housing allowance', 'earning', 25);
    await make('TRANSPORT', 'Transport allowance', 'earning', 10);
    // the engine only knows "fixed" and "% of basic": 9.75% of (basic + 25% housing) = 12.1875% of basic
    await make('GOSI', 'GOSI employee share', 'deduction', 12.1875);
    const notes = [];
    const list = await payRead(ctx, '/api/erp/pay/records/element', notes);
    const by = c => list.find(e => e.code === c);
    ok(by('HOUSING') && by('TRANSPORT') && by('GOSI'), 'three elements should exist');
    eq(by('GOSI').data.type, 'deduction', 'GOSI type'); eq(by('HOUSING').data.type, 'earning', 'housing type');
    ok(list.filter(e => e.status === 'Active').length >= 3, 'three active elements');
    return 'HOUSING 25, TRANSPORT 10 (earnings), GOSI 12.1875% of basic (= 9.75% of basic+housing) deduction. ' + notes.join('; ');
  });
};

// ==================================================================================== DAY 1
exports.day1 = async function (ctx) {
  const sara = ctx.U.sara;
  const H = P(ctx);

  // ---------------- U5-02 patients + duplicate
  await step('U5-02', 'Register patients A, B, C; duplicate of Mona is refused', async () => {
    const reg = async (name, sex, dob, nid, allergies, conditions) => must(await sara.post('/api/hospital/records/patient',
      hosBody('patient', null, { name, sex, dob, phone: '+9665000000' + nid.slice(-2), nationalId: nid, allergies, conditions })), 'register ' + name);
    const a = await reg('Mona Saleh', 'F', '1992-09-30', '1000000001', ['penicillin'], []);
    const b = await reg('Ahmed Al-Harbi', 'M', '1978-03-14', '1000000002', [], ['type 2 diabetes']);
    const c = await reg('Yousef Al-Qahtani', 'M', '2015-06-02', '1000000003', [], []);
    H.mona = { code: a.code, id: a.id }; H.ahmed = { code: b.code, id: b.id }; H.yousef = { code: c.code, id: c.id };
    ok(/^MRN-\d{6}$/.test(a.code) && /^MRN-\d{6}$/.test(b.code) && /^MRN-\d{6}$/.test(c.code), 'file numbers should look like MRN-000001: ' + [a.code, b.code, c.code]);
    eq(a.code, 'MRN-000001', 'Mona file number'); eq(b.code, 'MRN-000002', 'Ahmed file number'); eq(c.code, 'MRN-000003', 'Yousef file number');
    // the server detects a duplicate by national id only (see notes: no duplicate check on name + date of birth)
    const dup = refused(await sara.post('/api/hospital/records/patient', hosBody('patient', null, { name: 'Mona Saleh', sex: 'F', dob: '1992-09-30', nationalId: '1000000001', allergies: ['penicillin'], conditions: [] })), 'duplicate Mona', [409]);
    ok(/already registered/i.test(dup.text), 'duplicate message should say already registered: ' + dup.text);
    ok(dup.data && dup.data.code === a.code, 'duplicate response should point to ' + a.code);
    const all = await hosList(sara, 'patient');
    eq(all.length, 3, 'patients in the file after the duplicate attempt');
    return `${a.code}, ${b.code}, ${c.code}; duplicate refused (409) pointing to ${dup.data.code}`;
  });

  // ---------------- U5-03 appointments + conflict
  await step('U5-03', 'Appointments: Mona 09:00 booked, Ahmed 09:00 clashes, Ahmed 09:15 accepted', async () => {
    need(H.mona && H.ahmed, 'U5-02');
    const day = addDays(ctx.today, 4);          // a future day: the server refuses bookings in the past
    H.apptDay = day;
    const book = (p, t) => sara.post('/api/hospital/appointments', { patient: p.code, doctor: 'DR-001', start: `${day}T${t}`, reason: 'Check-up' });
    const m = must(await book(H.mona, '09:00'), 'book Mona');
    H.monaApt = { id: m.id, code: m.code };
    const clash = refused(await book(H.ahmed, '09:00'), 'Ahmed at 09:00', [409]);
    ok(/already has an appointment/i.test(clash.text), 'conflict message expected, got: ' + clash.text);
    const a = must(await book(H.ahmed, '09:15'), 'book Ahmed 09:15');
    H.ahmedApt = { id: a.id, code: a.code };
    eq(m.status, 'Booked', 'Mona status'); eq(a.status, 'Booked', 'Ahmed status');
    const list = await hosList(sara, 'appointment', `?ref=${day}`);
    eq(list.filter(x => x.status === 'Booked').length, 2, 'booked appointments that day');
    return `${day}: ${m.code} 09:00 Mona, ${a.code} 09:15 Ahmed; 09:00 clash -> "${(clash.data && clash.data.message) || clash.text}"`;
  });

  // ---------------- U5-14 recruitment
  await step('U5-14', 'Recruitment: vacancy, 2 candidates, interview, offer Hanan 9,000 from 2026-11-01, hire', async () => {
    must(await sara.post('/api/hr/records/vacancy', hr.rec('vacancy', { code: 'VAC-001', status: 'Open', data: { title: 'Registered Nurse', unit: 'MED', location: ctx.branch.RYD || 'RYD', openings: 1, grade: '' } })), 'vacancy');
    const cand = async (name, email) => must(await sara.post('/api/hr/records/candidate', hr.rec('candidate', { status: 'Applied', data: { name, email, phone: '', vacancy: 'VAC-001', source: 'UAT', notes: '' } })), 'candidate ' + name);
    const hanan = await cand('Hanan Al-Zahrani', `hanan.${ctx.run}@example.com`);
    const lama = await cand('Lama Al-Qarni', `lama.${ctx.run}@example.com`);
    const move = async (c, status, extra = {}) => must(await sara.put(`/api/hr/records/candidate/${c.id}`, hr.rec('candidate', { status, data: { ...c.data, ...extra } })), `move ${c.data.name} to ${status}`);
    await move(hanan, 'Interview'); await move(lama, 'Interview');
    const offered = await move(hanan, 'Offer', { offer: { basic: 9000, start: '2026-11-01' } });
    eq(offered.status, 'Offer', 'Hanan stage');
    // hire = create the employee (what the portal's hire form does) and mark the candidate Hired
    const body = { empNo: 'E006', fullName: 'Hanan Al-Zahrani', email: `hanan.${ctx.run}@example.com`, position: 'Registered Nurse', unit: 'MED', hireDate: '2026-11-01', status: 'Probation',
      basicSalary: 9000, managerEmpNo: 'E001', branch: ctx.branch.RYD || null, company: ctx.company || null, location: ctx.branch.RYD || null };
    const emp = must(await sara.post('/api/hr/employees', body), 'create employee Hanan');
    must(await sara.put(`/api/hr/records/candidate/${hanan.id}`, hr.rec('candidate', { status: 'Hired', data: { ...hanan.data, offer: { basic: 9000, start: '2026-11-01' } } })), 'mark hired');
    S(ctx).hanan = { id: emp.id, empNo: 'E006' };
    const emps = await hr.emps(sara);
    const h = emps.find(e => e.empNo === 'E006');
    ok(h, 'Hanan is not in the employee list');
    ok(String(h.hireDate).startsWith('2026-11-01'), 'Hanan start date should be 2026-11-01, got ' + h.hireDate);
    eq(num(h.basicSalary), 9000, 'Hanan basic');
    const cands = await hr.list(sara, 'candidate');
    eq(cands.find(c => c.data.name.startsWith('Hanan')).status, 'Hired', 'Hanan candidate status');
    eq(cands.find(c => c.data.name.startsWith('Lama')).status, 'Interview', 'Lama candidate status');
    return 'E006 Hanan, start 2026-11-01, basic 9000 (whether she is kept out of the October run is checked in U5-14b)';
  });

  // ---------------- U5-19 recurring meeting
  await step('U5-19', 'Recurring meeting "Department heads" weekly Sundays 10:00, 45 min, 4 invitees', async () => {
    const invitees = ['khalid', 'noura', 'faisal', 'reem'].map(k => ctx.users[k]);
    // Riyadh is UTC+3: 10:00 local = 07:00Z. 2026-10-18 is a Sunday. Until 2026-11-08 gives Sundays 18 Oct, 25 Oct, 1 Nov, 8 Nov.
    const r = must(await sara.post('/api/calendar/events', { kind: 'meeting', title: 'Department heads', start: '2026-10-18T07:00:00Z', end: '2026-10-18T07:45:00Z',
      attendees: invitees, repeat: 'weekly', repeatUntil: '2026-11-08T00:00:00Z', remindMinutes: 10, notes: 'Weekly heads meeting' }), 'create meeting');
    const ev = r.ev; ok(ev && ev.id, 'no event id returned');
    S(ctx).meetingId = ev.id;
    ctx.S.meeting = { id: ev.id, title: 'Department heads', owner: ctx.users.sara, start: '2026-10-18T07:00:00Z', end: '2026-10-18T07:45:00Z', repeat: 'weekly', attendees: invitees };
    const q = `/api/calendar/events?from=${encodeURIComponent('2026-10-01T00:00:00Z')}&to=${encodeURIComponent('2026-12-31T00:00:00Z')}`;
    const seen = {};
    for (const k of ['sara', 'khalid', 'noura', 'faisal', 'reem']) {
      const c = ctx.U[k]; if (!c) throw new Error('no client for ' + k);
      const list = must(await c.get(q), `events of ${k}`).filter(e => e.title === 'Department heads');
      eq(list.length, 4, `weekly occurrences visible to ${k}`);
      seen[k] = list.length;
      if (k === 'sara') {
        const days = list.map(e => new Date(e.start).toISOString().slice(0, 10));
        ok(JSON.stringify(days) === JSON.stringify(['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08']), 'occurrence dates: ' + days.join(','));
        ok(list.every(e => new Date(e.start).getUTCDay() === 0), 'every occurrence should be a Sunday');
        eq((new Date(list[0].end) - new Date(list[0].start)) / 60000, 45, 'duration in minutes');
      }
    }
    // an invitee answers (Noura yes); the owner sees the answer
    must(await ctx.U.noura.post(`/api/calendar/events/${ev.id}/rsvp`, { response: 'yes' }), 'Noura rsvp');
    const mine = must(await sara.get(q), 'events of sara again').find(e => e.id === ev.id);
    eq(mine.data.rsvp[ctx.users.noura], 'yes', 'Noura rsvp');
    // a person who is not invited cannot answer
    refused(await sara.post(`/api/calendar/events/${ev.id}/rsvp`, { response: 'yes' }), 'owner is not an attendee', [400]);
    // free/busy shows blocks only, for every invitee, no titles
    const fb = must(await sara.post('/api/calendar/freebusy', { users: [...invitees, ctx.users.sara], from: '2026-10-18T00:00:00Z', to: '2026-10-19T00:00:00Z' }), 'freebusy');
    for (const u of invitees) {
      ok(fb[u] && fb[u].length >= 1, `free/busy of ${u}: expected a busy block on 18 Oct, got ${fb[u] && fb[u].length}`);
      ok(fb[u].some(b => new Date(b.s).toISOString() === '2026-10-18T07:00:00.000Z' && new Date(b.e).toISOString() === '2026-10-18T07:45:00.000Z'), 'busy block 07:00-07:45Z missing for ' + u);
      ok(!JSON.stringify(fb[u]).includes('Department'), 'free/busy must not leak the title');
    }
    return `4 occurrences for all five calendars (${JSON.stringify(seen)}), Noura RSVP yes, free/busy shows the block; saved ctx.S.meeting.id=${ev.id}`;
  });

  // ---------------- U5-20 instant meeting
  await step('U5-20', 'Instant meeting with Noura; both get a room link', async () => {
    const r = must(await sara.post('/api/calendar/meetings/instant', { title: 'Quick sync with Noura', attendees: [ctx.users.noura], minutes: 30 }), 'instant meeting');
    ok(r.url && /^https:\/\//.test(r.url), 'meeting url missing: ' + JSON.stringify(r));
    const id = r.ev.id;
    const js = must(await sara.post(`/api/calendar/events/${id}/join`), 'Sara joins');
    const jn = must(await ctx.U.noura.post(`/api/calendar/events/${id}/join`), 'Noura joins');
    eq(js.room, jn.room, 'same room for both'); ok(js.url === jn.url, 'same url for both');
    // somebody not invited cannot join
    refused(await ctx.U.reem.post(`/api/calendar/events/${id}/join`), 'Reem joins an instant meeting she is not invited to', [403]);
    S(ctx).instant = id;
    return `room ${js.room} at ${js.domain} (opening the Jitsi window itself is a browser action)`;
  });

  // ---------------- U5-21 meeting in 3 minutes
  await step('U5-21', 'Meeting 3 minutes from now with a reminder; Join works', async () => {
    const start = new Date(Date.now() + 3 * 60000), end = new Date(start.getTime() + 30 * 60000);
    const r = must(await sara.post('/api/calendar/events', { kind: 'meeting', title: 'UAT starts soon', start: start.toISOString(), end: end.toISOString(), remindMinutes: 2, attendees: [] }), 'create');
    eq(r.ev.data.remind, 2, 'reminder minutes saved'); eq(r.ev.status, 'Scheduled', 'status');
    const j = must(await sara.post(`/api/calendar/events/${r.ev.id}/join`), 'join');
    ok(j.url && j.room, 'join url missing');
    const list = must(await sara.get(`/api/calendar/events?from=${encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400e3).toISOString())}`), 'events');
    ok(list.some(e => e.id === r.ev.id), 'meeting not in today\'s calendar');
    return 'created with remind=2 min, Join returns ' + j.url + ' (the popup itself: see U5-21m)';
  });
  manual('U5-21m', 'Reminder popup appears before the meeting starts', 'Browser toast: keep the Calendar page open for the 3 minutes and confirm the reminder pops up (about 2 minutes before) and the Join button opens the room.');

  // ---------------- U5-22 / U5-23 Muslim
  manual('U5-22', 'Muslim > Times: Riyadh (Umm al-Qura), switch to Jeddah', 'Prayer times are computed in the browser (no API). Check five prayers in order, countdown, Hijri date, Jeddah about 30 minutes later than Riyadh and within 2 minutes of a trusted timetable.');
  manual('U5-23', 'Muslim > Quran: Surah Al-Ikhlas 112, translation, audio; offline message', 'Uses an external Quran API and audio: needs internet. Verify four verses in Arabic with English translation, audio of verse 1, and a clear offline message with the network off.');
};

// ==================================================================================== DAY 2
exports.day2 = async function (ctx) {
  const sara = ctx.U.sara;
  const H = P(ctx);

  // ---------------- U5-04 check in Mona, vitals, diagnosis, glucose
  await step('U5-04', 'Check in Mona, vitals 120/80 temp 37.0, diagnosis J02, glucose 88 = Normal', async () => {
    need(H.monaApt, 'U5-03');
    const ci = must(await sara.post(`/api/hospital/appointments/${H.monaApt.id}/status`, { status: 'CheckedIn', today: ctx.today }), 'check in');
    eq(ci.appointment.status, 'CheckedIn', 'appointment status');
    const visit = ci.visit; ok(visit && visit.status === 'Open', 'visit should be Open');
    eq(visit.data.appointment, H.monaApt.code, 'visit linked to the appointment');
    H.monaVisit = { id: visit.id, code: visit.code };
    must(await sara.put(`/api/hospital/visits/${visit.id}`, { complaint: 'Sore throat', vitals: { sys: 120, dia: 80, temp: 37.0 }, diagnoses: [{ code: 'J02', name: 'Pharyngitis' }] }), 'vitals + diagnosis');
    const v = await hosOne(sara, 'visit', visit.id);
    eq(v.data.vitals.sys, 120, 'systolic'); eq(v.data.vitals.dia, 80, 'diastolic'); eq(v.data.vitals.temp, 37, 'temperature');
    eq(v.data.diagnoses[0].code, 'J02', 'diagnosis code');
    const lab = must(await sara.post(`/api/hospital/visits/${visit.id}/labs`, { tests: ['GLU'] }), 'order glucose');
    ok(lab.length === 1, 'one lab request expected'); H.monaLab = { id: lab[0].id, code: lab[0].code };
    const res = must(await sara.post(`/api/hospital/labrequests/${lab[0].id}/result`, { value: '88' }), 'result 88');
    eq(res.data.flag, 'Normal', 'flag for 88'); eq(res.status, 'Resulted', 'lab status');
    return `${visit.code} open from ${H.monaApt.code}; ${lab[0].code} glucose 88 = ${res.data.flag}`;
  });

  // ---------------- U5-05 allergy warning
  await step('U5-05', 'Prescribe AMOX to Mona: allergy blocks until a reason is entered; reason saved', async () => {
    need(H.monaVisit, 'U5-04');
    const item = { drug: 'AMOX', dose: '500 mg (1 capsule)', frequency: '3 times a day', days: 5, qty: 15 };
    const blocked = refused(await sara.post(`/api/hospital/visits/${H.monaVisit.id}/prescriptions`, { items: [item] }), 'prescription over an allergy', [409]);
    const warns = (blocked.data && blocked.data.warnings) || [];
    ok(warns.some(w => /ALLERGY/i.test(w)), 'expected an ALLERGY warning, got: ' + blocked.text);
    // a one-word reason is not enough (min 5 chars)
    refused(await sara.post(`/api/hospital/visits/${H.monaVisit.id}/prescriptions`, { items: [item], overrideReason: 'ok' }), 'too short reason', [409]);
    const reason = 'Culture negative, tolerated before';
    const rx = must(await sara.post(`/api/hospital/visits/${H.monaVisit.id}/prescriptions`, { items: [item], overrideReason: reason }), 'prescribe with reason');
    eq(rx.data.overrideReason, reason, 'saved reason'); ok(rx.data.warnings.length > 0, 'warnings kept on the record');
    eq(rx.status, 'Pending', 'prescription status');
    H.monaRx = { id: rx.id, code: rx.code };
    return `${rx.code} saved with reason "${reason}"; blocked first with: ${warns[0]}`;
  });

  // ---------------- U5-06 pharmacy partial + restock
  await step('U5-06', 'Pharmacy: AMOX dispensed Partial 10 of 15, restock +100, then Dispensed 15 of 15', async () => {
    need(H.monaRx, 'U5-05');
    // without the partial flag the pharmacy is told about the shortage
    const sh = refused(await sara.post(`/api/hospital/prescriptions/${H.monaRx.id}/dispense`, {}), 'dispense without stock', [409]);
    ok(/Not enough stock/i.test(sh.text), 'shortage message expected: ' + sh.text);
    const p1 = must(await sara.post(`/api/hospital/prescriptions/${H.monaRx.id}/dispense`, { allowPartial: true }), 'partial dispense');
    eq(p1.status, 'Partial', 'status after first dispense'); eq(p1.data.items[0].dispensed, 10, 'dispensed so far');
    const drugs = await hosList(sara, 'drug');
    const amox = drugs.find(d => d.code === 'AMOX');
    eq(amox.data.stock, 0, 'AMOX stock after partial');
    must(await sara.post(`/api/hospital/drugs/${amox.id}/stock`, { delta: 100, reason: 'purchase' }), 'restock');
    const p2 = must(await sara.post(`/api/hospital/prescriptions/${H.monaRx.id}/dispense`, {}), 'dispense the rest');
    eq(p2.status, 'Dispensed', 'status after second dispense'); eq(p2.data.items[0].dispensed, 15, 'dispensed in total');
    const after = (await hosList(sara, 'drug')).find(d => d.code === 'AMOX');
    eq(after.data.stock, 95, 'AMOX stock at the end');
    const moves = await hosList(sara, 'drugmove', '?parent=AMOX');
    ok(moves.length >= 3, 'stock movements should exist (dispense, restock, dispense): ' + moves.length);
    return 'Partial 10/15 -> restock +100 -> Dispensed 15/15; AMOX stock 95, ' + moves.length + ' movements';
  });

  // ---------------- U5-07 Ahmed critical result
  await step('U5-07', 'Ahmed: check in, glucose 450 = Critical high, result can be amended', async () => {
    need(H.ahmedApt, 'U5-03');
    const ci = must(await sara.post(`/api/hospital/appointments/${H.ahmedApt.id}/status`, { status: 'CheckedIn', today: ctx.today }), 'check in Ahmed');
    H.ahmedVisit = { id: ci.visit.id, code: ci.visit.code };
    must(await sara.put(`/api/hospital/visits/${ci.visit.id}`, { complaint: 'Thirst, fatigue', vitals: { sys: 130, dia: 85, temp: 36.8 }, diagnoses: [{ code: 'E11', name: 'Type 2 diabetes mellitus' }] }), 'diagnosis');
    const lab = must(await sara.post(`/api/hospital/visits/${ci.visit.id}/labs`, { tests: ['GLU'] }), 'order glucose');
    H.ahmedLab = { id: lab[0].id };
    const res = must(await sara.post(`/api/hospital/labrequests/${lab[0].id}/result`, { value: '450' }), 'result 450');
    eq(res.data.flag, 'Critical high', 'flag for 450');
    refused(await sara.post(`/api/hospital/labrequests/${lab[0].id}/result`, { value: '455' }), 'editing a released result without amend', [400]);
    const am = must(await sara.post(`/api/hospital/labrequests/${lab[0].id}/result`, { value: '455', amend: true, note: 'repeat sample' }), 'amend');
    eq(am.data.value, '455', 'amended value'); eq(am.data.flag, 'Critical high', 'flag after amend');
    ok(am.data.history && am.data.history.length === 1 && am.data.history[0].value === '450', 'history should keep the first value 450');
    return `${ci.visit.code}: 450 = Critical high; amended to 455 (history keeps 450)`;
  });

  // ---------------- U5-08 admit, prescribe, discharge
  await step('U5-08', 'Admit Ahmed to W1-01, prescribe METF 60, discharge with summary; bed Occupied then Available', async () => {
    need(H.ahmedVisit, 'U5-07');
    const adm = must(await sara.post('/api/hospital/admissions', { patient: H.ahmed.code, visit: H.ahmedVisit.code, bed: 'W1-01', reason: 'Hyperglycaemia' }), 'admit');
    eq(adm.status, 'Admitted', 'admission status'); H.ahmedAdm = { id: adm.id, code: adm.code };
    let bed = (await hosList(sara, 'bed')).find(b => b.code === 'W1-01');
    eq(bed.status, 'Occupied', 'W1-01 after admit');
    refused(await sara.post('/api/hospital/admissions', { patient: H.yousef.code, bed: 'W1-01', reason: 'x' }), 'second patient into an occupied bed', [409, 400]);
    const rx = must(await sara.post(`/api/hospital/visits/${H.ahmedVisit.id}/prescriptions`, { items: [{ drug: 'METF', dose: '500 mg', frequency: 'twice a day', days: 30, qty: 60 }] }), 'prescribe METF');
    eq(rx.data.warnings.length, 0, 'METF should carry no warning');
    // the invoice is built from what was really dispensed, so the pharmacy gives the 60 tablets (24.00 on the bill)
    const d = must(await sara.post(`/api/hospital/prescriptions/${rx.id}/dispense`, {}), 'dispense METF');
    eq(d.status, 'Dispensed', 'METF status');
    const summary = 'Stabilised, insulin adjusted, review in 1 week';
    const dis = must(await sara.post(`/api/hospital/admissions/${adm.id}/discharge`, { summary, outcome: 'Recovered' }), 'discharge');
    eq(dis.status, 'Discharged', 'admission after discharge'); eq(dis.data.summary, summary, 'discharge summary saved');
    bed = (await hosList(sara, 'bed')).find(b => b.code === 'W1-01');
    eq(bed.status, 'Available', 'W1-01 after discharge');
    const metf = (await hosList(sara, 'drug')).find(x => x.code === 'METF');
    eq(metf.data.stock, 140, 'METF stock');
    return `${adm.code}: W1-01 Occupied -> Available; summary saved on the admission record (not on the visit); METF 60 dispensed`;
  });
};

// ==================================================================================== DAY 3
exports.day3 = async function (ctx) {
  const sara = ctx.U.sara;
  const H = P(ctx);

  await step('U5-09', 'Close both visits; invoices Mona 268.00, Ahmed 624.00', async () => {
    need(H.monaVisit && H.ahmedVisit, 'U5-04/U5-07');
    const m = must(await sara.post(`/api/hospital/visits/${H.monaVisit.id}/close`), 'close Mona visit');
    const a = must(await sara.post(`/api/hospital/visits/${H.ahmedVisit.id}/close`), 'close Ahmed visit');
    eq(m.visit.status, 'Closed', 'Mona visit'); eq(a.visit.status, 'Closed', 'Ahmed visit');
    const invM = (await hosList(sara, 'invoice', `?parent=${m.visit.code}`))[0];
    const invA = (await hosList(sara, 'invoice', `?parent=${a.visit.code}`))[0];
    ok(invM && invA, 'invoices not found');
    const lines = inv => inv.data.lines.map(l => `${l.type} ${l.amount}`).join(', ');
    eq(invM.data.total, 268, 'Mona invoice total (200 consultation + 50 glucose + 18 AMOX): ' + lines(invM));
    eq(invA.data.total, 624, 'Ahmed invoice total (200 + 50 + 24 METF + 350 bed): ' + lines(invA));
    H.invMona = { id: invM.id, code: invM.code }; H.invAhmed = { id: invA.id, code: invA.code };
    ctx.S.hosInvoices = { mona: { id: invM.id, code: invM.code, total: 268 }, ahmed: { id: invA.id, code: invA.code, total: 624 } };
    // closed visits cannot be edited any more
    refused(await sara.put(`/api/hospital/visits/${m.visit.id}`, { complaint: 'late change' }), 'edit a closed visit', [400]);
    return `${invM.code} 268.00 [${lines(invM)}]; ${invA.code} 624.00 [${lines(invA)}]`;
  });

  await step('U5-10', 'Payments: Mona 268 cash = Paid; Ahmed 10,000 refused, then 300 card = Part-paid, balance 324', async () => {
    need(H.invMona && H.invAhmed, 'U5-09');
    const pm = must(await sara.post(`/api/hospital/invoices/${H.invMona.id}/pay`, { amount: 268, method: 'cash' }), 'Mona pays');
    eq(pm.status, 'Paid', 'Mona invoice status'); eq(pm.data.balance, 0, 'Mona balance');
    const over = refused(await sara.post(`/api/hospital/invoices/${H.invAhmed.id}/pay`, { amount: 10000, method: 'cash' }), 'overpayment', [400]);
    ok(/more than the balance/i.test(over.text) && /624/.test(over.text), 'overpayment message should mention the balance 624: ' + over.text);
    const pa = must(await sara.post(`/api/hospital/invoices/${H.invAhmed.id}/pay`, { amount: 300, method: 'card' }), 'Ahmed pays 300');
    eq(pa.status, 'Partial', 'Ahmed invoice status'); eq(pa.data.balance, 324, 'Ahmed balance');
    refused(await sara.post(`/api/hospital/invoices/${H.invMona.id}/pay`, { amount: 1, method: 'cash' }), 'paying a settled invoice', [400]);
    refused(await sara.post(`/api/hospital/invoices/${H.invAhmed.id}/pay`, { amount: 10, method: 'bitcoin' }), 'unknown payment method', [400]);
    return 'Mona Paid; Ahmed Partial, balance 324.00; overpayment refused: ' + over.text.slice(0, 80);
  });

  await step('U5-11', 'Hospital overview: billed 892, collected 568, outstanding 324, beds 0 of 6', async () => {
    const invs = await hosList(sara, 'invoice');
    const billed = invs.reduce((s, i) => s + num(i.data.total), 0);
    const paid = invs.reduce((s, i) => s + num(i.data.paid), 0);
    eq(billed, 892, 'billed (sum of invoices)'); eq(paid, 568, 'collected (sum of payments)');
    const d = must(await sara.get(`/api/hospital/dashboard?today=${utcDay()}&tz=0`), 'dashboard');
    eq(d.revenueToday, 568, 'dashboard revenue today (collected)'); eq(d.outstanding, 324, 'dashboard outstanding');
    eq(d.beds.total, 6, 'beds total'); eq(d.beds.occupied, 0, 'beds occupied'); eq(d.beds.occupancyPct, 0, 'occupancy');
    eq(d.patients, 3, 'patients'); eq(d.openVisits, 0, 'open visits');
    // the document says "admissions 1": the dashboard counts people CURRENTLY admitted (0 after discharge); the admission itself is one record
    eq(d.admitted, 0, 'currently admitted');
    eq((await hosList(sara, 'admission')).length, 1, 'admission records');
    return `billed ${billed} = collected ${paid} + outstanding ${d.outstanding}; beds ${d.beds.occupied} of ${d.beds.total}; 1 admission record, 0 currently admitted`;
  });
};

// ==================================================================================== DAY 4
exports.day4 = async function (ctx) {
  const sara = ctx.U.sara, reem = ctx.U.reem;

  await step('U5-15', 'Leave: Reem requests annual leave 25-27 Oct (3 days); Sara approves; balance 21 -> 18', async () => {
    const data = { type: 'ANNUAL', from: '2026-10-25', to: '2026-10-27', days: 3, reason: 'Family' };
    const mine0 = must(await reem.get('/api/hr/employees/me'), 'Reem profile');
    eq(mine0.empNo, EMPNO.reem, 'Reem is linked to employee ' + EMPNO.reem);
    const created = must(await reem.post('/api/hr/records/leave', { id: 'new', kind: 'leave', status: 'Pending', data }), 'Reem requests leave');
    eq(created.empNo, EMPNO.reem, 'request belongs to Reem'); eq(created.status, 'Pending', 'request status');
    // Reem cannot approve her own request
    refused(await reem.put(`/api/hr/records/leave/${created.id}`, { id: created.id, kind: 'leave', status: 'Approved', data }), 'Reem approves herself', [403]);
    const balance = async () => {
      const types = await hr.list(sara, 'leavetype'); const total = num(types.find(t => t.code === 'ANNUAL').data.days);
      const used = (await hr.list(sara, 'leave')).filter(l => l.empNo === EMPNO.reem && l.status === 'Approved' && l.data.type === 'ANNUAL' && String(l.data.from).startsWith('2026')).reduce((s, l) => s + num(l.data.days), 0);
      return { total, used, left: total - used };
    };
    const before = await balance(); eq(before.left, 21, 'balance before approval');
    const ap = must(await sara.put(`/api/hr/records/leave/${created.id}`, { id: created.id, kind: 'leave', status: 'Approved', data }), 'Sara approves');
    eq(ap.status, 'Approved', 'approved'); eq(ap.data.decidedBy, ctx.users.sara, 'decidedBy');
    const after = await balance(); eq(after.left, 18, 'balance after approval');
    // Reem sees her request as approved
    const hers = must(await reem.get('/api/hr/records/leave'), 'Reem leave list');
    ok(hers.length >= 1 && hers.every(l => l.empNo === EMPNO.reem), 'Reem should only see her own leave');
    eq(hers.find(l => l.id === created.id).status, 'Approved', 'Reem sees approved');
    S(ctx).leaveId = created.id;
    return 'balance 21 -> 18 (computed from approved ANNUAL leave records, as the portal does); the HR calendar view is a UI feature';
  });

  await step('U5-16', 'Performance: Q3 2026 review + goal for Reem (4 of 5); Reem sees only her own', async () => {
    const goal = must(await sara.post('/api/hr/records/goal', { id: 'new', kind: 'goal', empNo: EMPNO.reem, status: 'Active', data: { cycle: 'Q3 2026', title: 'Close 200,000 of B2B sales by December', kpi: 'B2B sales (SAR)', weight: 100, target: 200000, actual: 0 } }), 'goal');
    const rev = must(await sara.post('/api/hr/records/review', { id: 'new', kind: 'review', empNo: EMPNO.reem, status: 'Final', data: { cycle: 'Q3 2026', stage: 'Final', rating: 4, comments: 'Strong quarter', reviewer: ctx.names.sara.display } }), 'review');
    eq(rev.data.rating, 4, 'rating saved');
    // a review of somebody else (test fixture, so that "no one else's" is a real check)
    must(await sara.post('/api/hr/records/review', { id: 'new', kind: 'review', empNo: EMPNO.faisal, status: 'Final', data: { cycle: 'Q3 2026', stage: 'Final', rating: 3, comments: 'Solid', reviewer: ctx.names.sara.display } }), 'review of Faisal');
    const all = await hr.list(sara, 'review');
    ok(all.some(r => r.empNo === EMPNO.faisal) && all.some(r => r.empNo === EMPNO.reem), 'Sara sees both reviews');
    const rr = must(await ctx.U.reem.get('/api/hr/records/review'), 'Reem reviews');
    eq(rr.length, 1, 'reviews visible to Reem'); eq(rr[0].empNo, EMPNO.reem, 'owner of the review'); eq(rr[0].data.rating, 4, 'her rating');
    const rg = must(await ctx.U.reem.get('/api/hr/records/goal'), 'Reem goals');
    ok(rg.length === 1 && rg[0].id === goal.id, 'Reem sees only her goal');
    // and cannot create or change reviews, or read recruitment
    refused(await ctx.U.reem.post('/api/hr/records/review', { id: 'new', kind: 'review', empNo: EMPNO.reem, status: 'Final', data: { cycle: 'Q3 2026', rating: 5 } }), 'Reem writes her own review', [403]);
    refused(await ctx.U.reem.get('/api/hr/records/candidate'), 'Reem reads candidates', [403]);
    return 'Reem sees 1 review (4/5) and 1 goal; Faisal\'s review and recruitment data are hidden';
  });
};

// ==================================================================================== DAY 5
exports.day5 = async function (ctx) {
  const sara = ctx.U.sara;

  await step('U5-17a', 'Payroll accounts (expense/payable/deduction) set so that Noura can post', async () => {
    const accts = await (async () => { const r = await sara.get('/api/erp/pay/lookups/accounts'); return must(r, 'accounts lookup'); })();
    const pick = (codes, re) => (accts.find(a => codes.includes(a.code)) || accts.find(a => re.test(a.name)) || {}).code;
    const expenseAccount = pick(['6100'], /salar|wage|payroll/i), payableAccount = pick(['2200'], /accrued|salar.*payable|payroll/i);
    ok(expenseAccount && payableAccount, `chart of accounts lacks a salary expense / accrued liability account (found ${accts.length} accounts); Noura loads the chart on Day 0`);
    const data = { expenseAccount, payableAccount, deductionAccount: payableAccount };
    const c = await sara.post('/api/erp/pay/records/setting', erpBody('setting', { code: 'defaults', data }));
    if (c.status === 409) {
      const cur = must(await sara.get('/api/erp/pay/records/setting'), 'settings').find(x => x.code === 'defaults');
      must(await sara.put(`/api/erp/pay/records/setting/${cur.id}`, erpBody('setting', { code: 'defaults', data })), 'update defaults');
    } else must(c, 'create payroll defaults');
    return `expense ${expenseAccount}, payable ${payableAccount}, deductions ${payableAccount}`;
  });

  await step('U5-17', 'Payroll: bonus 1,000 for Faisal, run October 2026, calculate; totals net 112,759.37; waits for Noura', async () => {
    const notes = [];
    must(await sara.post('/api/erp/pay/records/adjustment', erpBody('adjustment', { data: { period: PERIOD, empNo: EMPNO.faisal, amount: 1000, type: 'earning', note: 'Bonus (not subject to GOSI)' } })), 'bonus adjustment');
    const run = must(await sara.post('/api/erp/pay/records/run', erpBody('run', { company: ctx.company || null, data: { period: PERIOD, name: 'October 2026 payroll' } })), 'create run');
    eq(run.status, 'Draft', 'new run status');
    const slipsOf = async r => (await payRead(ctx, '/api/erp/pay/records/payslip?take=5000', null)).filter(s => s.parent === r.id);

    let calc = must(await sara.post(`/api/erp/pay/runs/${run.id}/calculate`), 'calculate');
    let slips = await slipsOf(run);
    const hananIn = slips.some(s => s.data.empNo === 'E006');
    S(ctx).hananInRun = hananIn;
    if (hananIn) {
      // Real behaviour: the engine pays every non-terminated employee; the start date (2026-11-01) is ignored.
      // So that the October figures of the document hold for Noura's approval, Hanan is parked outside the run's company during the calculation.
      notes.push('Hanan (start 2026-11-01) was INCLUDED by the first calculation -> parked outside the run company, recalculated');
      const emps = await hr.emps(sara); const h = emps.find(e => e.empNo === 'E006');
      must(await sara.put(`/api/hr/employees/${h.id}`, { ...h, company: 'NOT-STARTED' }), 'park Hanan');
      calc = must(await sara.post(`/api/erp/pay/runs/${run.id}/calculate`), 'recalculate');
      const h2 = (await hr.emps(sara)).find(e => e.empNo === 'E006');
      must(await sara.put(`/api/hr/employees/${h2.id}`, { ...h2, company: ctx.company || null }), 'restore Hanan');
      slips = await slipsOf(run);
    }
    eq(calc.status, 'Calculated', 'run status after calculate (the API has no separate "submit": Calculated = waiting for Noura)');
    eq(calc.data.count, 5, 'employees in the run');
    // per employee
    for (const [k, no] of Object.entries(EMPNO)) {
      const s = slips.find(x => x.data.empNo === no); ok(s, `payslip of ${k} (${no}) missing in the run`);
      eq(s.data.gross, EXPECT[no].gross, `gross of ${k}`); eq(s.data.totalDeductions, EXPECT[no].ded, `GOSI of ${k}`); eq(s.data.net, EXPECT[no].net, `net of ${k}`);
    }
    // run totals: gross includes the bonus (122,850 + 1,000)
    eq(calc.data.gross, 123850, 'run gross (122,850 + 1,000 bonus)'); eq(calc.data.deductions, 11090.63, 'run GOSI'); eq(calc.data.net, 112759.37, 'run net');
    // Sara may not approve her own run
    refused(await sara.post(`/api/erp/pay/runs/${run.id}/approve`), 'Sara approving the run', [403]);
    ctx.S.payRun = { id: run.id, code: run.code, period: PERIOD, status: 'Calculated', gross: 123850, deductions: 11090.63, net: 112759.37, count: 5, bonus: 1000 };
    return `${run.code} Calculated: gross 123,850.00, GOSI 11,090.63, net 112,759.37 (5 employees); ` + notes.join('; ');
  });

  await step('U5-14b', 'Hanan (start 2026-11-01) is not paid in the October run', async () => {
    const inRun = S(ctx).hananInRun;
    if (inRun === undefined) throw new Error('depends on U5-17, which did not calculate a run');
    if (inRun) throw new Error('DEFECT: the payroll calculation ignores the employee start date: Hanan (hireDate 2026-11-01, basic 9,000) was included in the October 2026 run on first calculation (she would add 12,150.00 gross, 1,096.88 GOSI, 11,053.12 net). Doc expects her to be excluded.');
    return 'Hanan was not in the run';
  });

  await step('U5-18', 'Payslips: Reem sees only her own; others\' pay and the employee list are refused', async () => {
    const reem = ctx.U.reem;
    const run = need(ctx.S.payRun, 'U5-17');
    // Reem has no HR rights: no employee list (no salaries), no summary
    refused(await reem.get('/api/hr/employees'), 'Reem lists employees', [403]);
    refused(await reem.get('/api/hr/summary'), 'Reem opens the HR summary', [403]);
    const me = must(await reem.get('/api/hr/employees/me'), 'Reem profile'); eq(me.empNo, EMPNO.reem, 'Reem profile');
    const r = await reem.get('/api/erp/pay/records/payslip?take=5000');
    if (r.status === 403) throw new Error('Reem is refused even her OWN payslips (HTTP 403): the sales role has no pay.self and u0.js does not add it (see Needed changes: give reem pay.self)');
    const list = must(r, 'Reem payslips');
    ok(list.length >= 1, 'Reem should see her own payslip');
    ok(list.every(s => s.data.empNo === EMPNO.reem), 'Reem sees a payslip that is not hers: ' + list.map(s => s.data.empNo).join(','));
    const mine = list.find(s => s.parent === run.id); ok(mine, 'her October payslip is missing');
    eq(mine.data.net, 18421.87, 'Reem net pay'); eq(mine.data.gross, 20250, 'Reem gross');
    // Khalid's slip exists (admin sees it) but is not in Reem's list
    const adminList = must(await ctx.U.khalid.get('/api/erp/pay/records/payslip?take=5000'), 'admin payslips');
    const khalidSlip = adminList.find(s => s.data.empNo === EMPNO.khalid && s.parent === run.id); ok(khalidSlip, 'Khalid payslip missing for admin');
    ok(!list.some(s => s.id === khalidSlip.id), 'Khalid\'s payslip leaked into Reem\'s list');
    // she cannot change payslips or runs, or read payroll setup
    refused(await reem.put(`/api/erp/pay/records/payslip/${khalidSlip.id}`, { id: khalidSlip.id, module: 'pay', kind: 'payslip', data: { net: 1 } }), 'Reem edits a payslip', [400, 403]);
    refused(await reem.post(`/api/erp/pay/runs/${run.id}/calculate`), 'Reem recalculates the run', [403]);
    refused(await reem.get('/api/erp/pay/records/run'), 'Reem reads runs', [403]);
    return `Reem sees ${list.length} payslip(s), all hers (net 18,421.87); Khalid's slip hidden; employees/summary/runs refused`;
  });
};
