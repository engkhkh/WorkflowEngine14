// HR officer: departments, employees (create, CSV import, org chart), leave + approval, performance, recruitment, HR overview.
const { must, refused, eq, ok, addDays } = require('../lib');
const num = x => Number(x);

module.exports = {
  id: 'hr-officer',
  title: 'HR officer',
  modules: ['hr'],
  role: 'hr',
  perms: ['hr.*'],
  probe: { path: '/api/hr/summary', perm: 'hr.reports.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, ws = u.ws, admin = ws.admin;
    const rec = (kind, o) => ({ id: 'new', kind, ...o });
    const hrList = async kind => must(await c.get(`/api/hr/records/${kind}`), 'list ' + kind);
    const emps = async () => must(await c.get('/api/hr/employees'), 'employees').filter(e => String(e.empNo).endsWith('-' + K));
    const NO = p => `${p}-${K}`;
    const emp = (p, extra = {}) => ({ empNo: NO(p), fullName: `Emp ${p} ${K}`, email: `${p.toLowerCase()}.${K.toLowerCase()}@example.com`, unit: `ENG-${K}`, position: 'Analyst', hireDate: '2024-01-15', status: 'Active', basicSalary: 8000, company: ws.company || null, branch: ws.branch.RYD || null, ...extra });
    const LT = `ANN-${K}`, VAC = `VAC-${K}`;
    const leaveData = (from, to, days) => ({ type: LT, from, to, days, reason: 'Leave ' + K });

    await u.step('HR-01', 'Organisation: 3 departments (one under another), position, leave type; duplicate and codeless refused; rename and delete work', async () => {
      const unit = (code, name, parent = '') => c.post('/api/hr/records/unit', rec('unit', { code, data: { name, nameAr: '', level: 'department', parent, manager: '' } }));
      must(await unit(`ENG-${K}`, 'Engineering ' + K), 'unit ENG');
      must(await unit(`OPS-${K}`, 'Operations ' + K), 'unit OPS');
      must(await unit(`QA-${K}`, 'Quality ' + K, `ENG-${K}`), 'unit QA under ENG');
      must(await c.post('/api/hr/records/position', rec('position', { code: `POS-${K}`, data: { name: 'Senior analyst ' + K } })), 'position');
      must(await c.post('/api/hr/records/leavetype', rec('leavetype', { code: LT, data: { name: 'Annual leave ' + K, nameAr: '', days: 21 } })), 'leave type');
      refused(await unit(`ENG-${K}`, 'dup'), 'duplicate department', [409]);
      refused(await unit('', 'no code'), 'department without code', [400]);
      const units = await hrList('unit');
      for (const code of [`ENG-${K}`, `OPS-${K}`, `QA-${K}`]) ok(units.some(x => x.code === code), code + ' not listed');
      eq(units.find(x => x.code === `QA-${K}`).data.parent, `ENG-${K}`, 'parent link');
      const ops = units.find(x => x.code === `OPS-${K}`);
      const up = must(await c.put(`/api/hr/records/unit/${ops.id}`, rec('unit', { code: `OPS-${K}`, data: { ...ops.data, name: 'Operations renamed ' + K } })), 'rename');
      eq(up.data.name, 'Operations renamed ' + K, 'new name');
      must(await unit(`TMP-${K}`, 'Temp'), 'temp unit');
      const tmp = (await hrList('unit')).find(x => x.code === `TMP-${K}`);
      ok((await c.del(`/api/hr/records/unit/${tmp.id}`)).status === 204, 'delete temp unit');
      ok(!(await hrList('unit')).some(x => x.code === `TMP-${K}`), 'deleted unit still listed');
      refused(await c.get('/api/hr/records/nokind'), 'unknown record kind', [404]);
      return '3 departments, QA under ENG, leave type ' + LT;
    });

    await u.step('HR-02', 'Employees: manager + 2 staff created; missing name, duplicate number, bad status, bad e-mail refused', async () => {
      const m = must(await c.post('/api/hr/employees', emp('M', { position: 'Manager', basicSalary: 15000, username: u.username })), 'create manager');
      eq(m.empNo, NO('M'), 'empNo'); eq(m.basicSalary, 15000, 'salary');
      must(await c.post('/api/hr/employees', emp('S1', { managerEmpNo: NO('M') })), 'create S1');
      must(await c.post('/api/hr/employees', emp('S2', { managerEmpNo: NO('M'), basicSalary: 9000, unit: `OPS-${K}` })), 'create S2');
      refused(await c.post('/api/hr/employees', emp('X1', { fullName: '' })), 'no name', [400]);
      refused(await c.post('/api/hr/employees', emp('X2', { empNo: '' })), 'no number', [400]);
      refused(await c.post('/api/hr/employees', emp('M')), 'duplicate number', [409]);
      refused(await c.post('/api/hr/employees', emp('X3', { status: 'Retired' })), 'bad status', [400]);
      refused(await c.post('/api/hr/employees', emp('X4', { email: 'not-an-email' })), 'bad e-mail', [400]);
      const l = await emps();
      eq(l.length, 3, 'my employees');
      eq(l.find(e => e.empNo === NO('S2')).basicSalary, 9000, 'S2 salary');
      S.mId = l.find(e => e.empNo === NO('M')).id;
      return '3 employees, 5 invalid creates refused';
    });

    await u.step('HR-03', 'CSV import: 3 rows created, bad rows reported, re-import skipped / updated', async () => {
      const head = 'empNo,fullName,email,unit,position,managerEmpNo,branch,company,basicSalary,username,hireDate,status'.split(',');
      const line = (p, sal) => [NO(p), `Imported ${p} ${K}`, `${p.toLowerCase()}.${K.toLowerCase()}@example.com`, `ENG-${K}`, 'Tester', NO('M'), ws.branch.JED || '', ws.company || '', sal, '', '2025-03-01', 'Active'];
      const toRows = lines => lines.map((cells, i) => { const data = {}; head.forEach((k, j) => { if (k === 'basicSalary') data[k] = Number(cells[j]); else if (cells[j] !== '') data[k] = cells[j]; }); return { row: i + 2, data }; });
      const good = [line('I1', 5000), line('I2', 5500), line('I3', 6000)];
      const bad = [['', 'No number', '', '', '', '', '', '', 1, '', '', 'Active'], [NO('I1'), 'Dup in file', '', '', '', '', '', '', 1, '', '', 'Active']];
      const r1 = must(await c.post('/api/hr/employees/import', { rows: toRows([...good, ...bad]), updateExisting: true }), 'import');
      eq(r1.created, 3, 'created'); ok(r1.errors.length === 2, 'expected 2 row errors, got ' + JSON.stringify(r1.errors));
      const r2 = must(await c.post('/api/hr/employees/import', { rows: toRows(good), updateExisting: false }), 'import again skip');
      eq(r2.skipped, 3, 'skipped'); eq(r2.created, 0, 'created again');
      const r3 = must(await c.post('/api/hr/employees/import', { rows: toRows([line('I1', 5200), line('I2', 5500), line('I3', 6000)]), updateExisting: true }), 'import update');
      eq(r3.updated, 3, 'updated');
      const l = await emps();
      eq(l.length, 6, 'employees after import'); eq(l.find(e => e.empNo === NO('I1')).basicSalary, 5200, 'I1 salary after update');
      return 'created 3, 2 errors, skipped 3, updated 3';
    });

    await u.step('HR-04', 'Update employee (salary, department), terminate one, delete one', async () => {
      const l = await emps(); const s1 = l.find(e => e.empNo === NO('S1'));
      const up = must(await c.put(`/api/hr/employees/${s1.id}`, { ...s1, basicSalary: 8800, unit: `OPS-${K}`, position: 'Senior analyst' }), 'update S1');
      eq(up.basicSalary, 8800, 'new salary');
      refused(await c.put(`/api/hr/employees/${s1.id}`, { ...s1, empNo: NO('M') }), 'change to existing number', [409]);
      refused(await c.put(`/api/hr/employees/${s1.id}`, { ...s1, fullName: '' }), 'blank name on update', [400]);
      const i3 = l.find(e => e.empNo === NO('I3'));
      must(await c.put(`/api/hr/employees/${i3.id}`, { ...i3, status: 'Terminated', terminationDate: ws.today }), 'terminate I3');
      must(await c.post('/api/hr/employees', emp('DEL')), 'create DEL');
      const del = (await emps()).find(e => e.empNo === NO('DEL'));
      ok((await c.del(`/api/hr/employees/${del.id}`)).status === 204, 'delete employee');
      const l2 = await emps();
      ok(!l2.some(e => e.empNo === NO('DEL')), 'deleted employee still listed');
      eq(l2.find(e => e.empNo === NO('I3')).status, 'Terminated', 'I3 status');
      eq(l2.find(e => e.empNo === NO('S1')).unit, `OPS-${K}`, 'S1 department');
      return 'S1 8,800 in OPS; I3 terminated; DEL removed';
    });

    await u.step('HR-05', 'Org chart: manager has 5 direct reports (S1, S2, I1, I2, I3); me-profile links the manager to this user', async () => {
      const l = await emps();
      const direct = l.filter(e => e.managerEmpNo === NO('M'));
      eq(direct.length, 5, 'direct reports (S1, S2, I1, I2, I3)');
      ok(l.find(e => e.empNo === NO('M')).managerEmpNo == null, 'manager must be on top');
      const me = must(await c.get('/api/hr/employees/me'), 'my profile');
      eq(me.empNo, NO('M'), 'me.empNo');
      const byUnit = {}; for (const e of l.filter(x => x.status !== 'Terminated')) byUnit[e.unit] = (byUnit[e.unit] || 0) + 1;
      eq(byUnit[`ENG-${K}`] || 0, 3, 'active people in ENG (M, I1, I2)'); eq(byUnit[`OPS-${K}`] || 0, 2, 'active people in OPS (S1, S2)');
      return 'tops 1, direct reports 5 (one terminated), profile link ok';
    });

    await u.step('HR-06', 'Leave: request 3 days, approved by admin (decidedBy), balance 21 -> 18; a rejected request does not use days', async () => {
      const s1 = NO('S1');
      const created = must(await c.post('/api/hr/records/leave', rec('leave', { empNo: s1, status: 'Pending', data: leaveData('2026-11-08', '2026-11-10', 3) })), 'request leave');
      eq(created.status, 'Pending', 'status'); eq(created.empNo, s1, 'employee');
      refused(await c.post('/api/hr/records/leave', rec('leave', { status: 'Pending', data: leaveData('2026-11-08', '2026-11-10', 3) })), 'leave without employee', [400]);
      const balance = async () => {
        const total = num((await hrList('leavetype')).find(t => t.code === LT).data.days);
        const used = (await hrList('leave')).filter(l => l.empNo === s1 && l.status === 'Approved' && l.data.type === LT).reduce((a, l) => a + num(l.data.days), 0);
        return total - used;
      };
      eq(await balance(), 21, 'balance before');
      const ap = must(await admin.put(`/api/hr/records/leave/${created.id}`, { id: created.id, kind: 'leave', status: 'Approved', data: created.data }), 'approve');
      eq(ap.status, 'Approved', 'approved'); eq(ap.data.decidedBy, admin.name, 'decidedBy');
      eq(await balance(), 18, 'balance after');
      const r2 = must(await c.post('/api/hr/records/leave', rec('leave', { empNo: s1, status: 'Pending', data: leaveData('2026-12-01', '2026-12-05', 5) })), 'second request');
      const rj = must(await admin.put(`/api/hr/records/leave/${r2.id}`, { id: r2.id, kind: 'leave', status: 'Rejected', data: r2.data }), 'reject');
      eq(rj.status, 'Rejected', 'rejected'); eq(await balance(), 18, 'balance after rejection');
      return 'balance 21 -> 18; rejected 5-day request kept the balance';
    });

    await u.step('HR-07', 'Leave overview: a pending request and a leave covering today are counted in the HR summary', async () => {
      must(await c.post('/api/hr/records/leave', rec('leave', { empNo: NO('S2'), status: 'Pending', data: leaveData(addDays(ws.today, 30), addDays(ws.today, 31), 2) })), 'pending request');
      const today = must(await c.post('/api/hr/records/leave', rec('leave', { empNo: NO('S2'), status: 'Pending', data: leaveData(ws.today, ws.today, 1) })), 'leave today');
      must(await admin.put(`/api/hr/records/leave/${today.id}`, { id: today.id, kind: 'leave', status: 'Approved', data: today.data }), 'approve today');
      const sum = must(await c.get('/api/hr/summary'), 'summary');
      ok(sum.pendingLeave >= 1, 'pendingLeave ' + sum.pendingLeave); ok(sum.onLeaveToday >= 1, 'onLeaveToday ' + sum.onLeaveToday);
      const mine = (await hrList('leave')).filter(l => String(l.empNo).endsWith('-' + K));
      eq(mine.filter(l => l.status === 'Pending').length, 1, 'my pending'); eq(mine.filter(l => l.status === 'Approved').length, 2, 'my approved');
      return `pending ${sum.pendingLeave}, on leave today ${sum.onLeaveToday} (workspace-wide)`;
    });

    await u.step('HR-08', 'Performance: goal 200,000 with 150,000 achieved (75%), reviews rated 4 and 5, review without employee refused', async () => {
      const goal = must(await c.post('/api/hr/records/goal', rec('goal', { empNo: NO('S1'), status: 'Active', data: { cycle: 'Q4 2026', title: 'Sales ' + K, kpi: 'SAR', weight: 100, target: 200000, actual: 0 } })), 'goal');
      const g2 = must(await c.put(`/api/hr/records/goal/${goal.id}`, rec('goal', { empNo: NO('S1'), status: 'Active', data: { ...goal.data, actual: 150000 } })), 'update goal');
      eq(num(g2.data.actual) / num(g2.data.target) * 100, 75, 'achievement %');
      must(await c.post('/api/hr/records/review', rec('review', { empNo: NO('S1'), status: 'Final', data: { cycle: 'Q4 2026', stage: 'Final', rating: 4, comments: 'Good', reviewer: u.username } })), 'review S1');
      must(await c.post('/api/hr/records/review', rec('review', { empNo: NO('S2'), status: 'Final', data: { cycle: 'Q4 2026', stage: 'Final', rating: 5, comments: 'Excellent', reviewer: u.username } })), 'review S2');
      refused(await c.post('/api/hr/records/review', rec('review', { status: 'Final', data: { rating: 3 } })), 'review without employee', [400]);
      const rv = (await hrList('review')).filter(r => String(r.empNo).endsWith('-' + K));
      eq(rv.length, 2, 'my reviews'); eq(rv.find(r => r.empNo === NO('S2')).data.rating, 5, 'S2 rating');
      const sum = must(await c.get('/api/hr/summary'), 'summary');
      ok(sum.ratings.some(r => r.name === '4' && r.count >= 1) && sum.ratings.some(r => r.name === '5' && r.count >= 1), 'ratings distribution lacks 4/5: ' + JSON.stringify(sum.ratings));
      ok((await hrList('goal')).some(g => g.id === goal.id && num(g.data.actual) === 150000), 'goal progress not stored');
      return 'goal 75%, ratings 4 and 5 in the distribution';
    });

    await u.step('HR-09', 'Recruitment: vacancy (2 openings), 3 candidates, interview, offer, hire; duplicate vacancy refused; vacancy closed', async () => {
      const vac = must(await c.post('/api/hr/records/vacancy', rec('vacancy', { code: VAC, status: 'Open', data: { title: 'Engineer ' + K, unit: `ENG-${K}`, location: ws.branch.RYD || 'RYD', openings: 2, grade: '' } })), 'vacancy');
      refused(await c.post('/api/hr/records/vacancy', rec('vacancy', { code: VAC, data: {} })), 'duplicate vacancy', [409]);
      refused(await c.post('/api/hr/records/vacancy', rec('vacancy', { code: '', data: {} })), 'vacancy without code', [400]);
      const a = must(await c.post('/api/hr/records/candidate', rec('candidate', { status: 'Applied', data: { name: `Cand A ${K}`, email: `a.${K.toLowerCase()}@example.com`, vacancy: VAC, source: 'Load' } })), 'cand A');
      const b = must(await c.post('/api/hr/records/candidate', rec('candidate', { status: 'Applied', data: { name: `Cand B ${K}`, email: `b.${K.toLowerCase()}@example.com`, vacancy: VAC, source: 'Load' } })), 'cand B');
      const d = must(await c.post('/api/hr/records/candidate', rec('candidate', { status: 'Applied', data: { name: `Cand C ${K}`, email: `c.${K.toLowerCase()}@example.com`, vacancy: VAC, source: 'Load' } })), 'cand C');
      const mv = (x, status, extra = {}) => c.put(`/api/hr/records/candidate/${x.id}`, rec('candidate', { status, data: { ...x.data, ...extra } }));
      must(await mv(a, 'Interview', { interview: { date: addDays(ws.today, 3), panel: 'HR + Eng' } }), 'A interview');
      must(await mv(b, 'Interview'), 'B interview');
      const off = must(await mv(a, 'Offer', { offer: { basic: 9500, start: addDays(ws.today, 30) } }), 'A offer');
      eq(off.status, 'Offer', 'offer stage'); eq(off.data.offer.basic, 9500, 'offer salary');
      must(await mv(d, 'Rejected'), 'C rejected');
      const hire = must(await c.post('/api/hr/employees', emp('HIRE', { fullName: `Cand A ${K}`, hireDate: addDays(ws.today, 30), status: 'Probation', basicSalary: 9500 })), 'create employee from offer');
      eq(hire.basicSalary, 9500, 'hire salary');
      must(await mv(a, 'Hired', { offer: off.data.offer }), 'A hired');
      const cs = (await hrList('candidate')).filter(x => x.data.vacancy === VAC);
      eq(cs.find(x => x.data.name.startsWith('Cand A')).status, 'Hired', 'A'); eq(cs.find(x => x.data.name.startsWith('Cand B')).status, 'Interview', 'B'); eq(cs.find(x => x.data.name.startsWith('Cand C')).status, 'Rejected', 'C');
      const sum = must(await c.get('/api/hr/summary'), 'summary');
      ok(sum.openVacancies >= 1 && sum.openPositions >= 2 && sum.candidatesInPipeline >= 1, `recruitment numbers ${sum.openVacancies}/${sum.openPositions}/${sum.candidatesInPipeline}`);
      must(await c.put(`/api/hr/records/vacancy/${vac.id}`, rec('vacancy', { code: VAC, status: 'Closed', data: vac.data })), 'close vacancy');
      eq((await hrList('vacancy')).find(v => v.code === VAC).status, 'Closed', 'vacancy status');
      return 'A hired at 9,500, B in interview, C rejected, vacancy closed';
    });

    await u.step('HR-10', 'HR overview: totals, status counts, payroll, departments, hires and tenure numbers', async () => {
      const mine = await emps();
      const sum = must(await c.get('/api/hr/summary'), 'summary');
      ok(sum.total >= mine.length, `total ${sum.total} < mine ${mine.length}`);
      ok(sum.terminated >= 1, 'terminated >= 1'); ok(sum.probation >= 1, 'probation >= 1');
      const myActive = mine.filter(e => e.status !== 'Terminated');
      const myPay = myActive.reduce((a, e) => a + num(e.basicSalary), 0);
      ok(num(sum.monthlyPayroll) >= myPay - 0.01, `monthlyPayroll ${sum.monthlyPayroll} < my staff ${myPay}`);
      ok(sum.byUnit.some(x => x.name === `ENG-${K}`) || sum.byUnit.some(x => x.name === `OPS-${K}`) || sum.byUnit.length === 12, 'my departments missing from byUnit');
      eq(sum.hires.length, 12, 'hires months'); ok(sum.newHires12m >= 1, 'newHires12m');
      ok(typeof sum.avgTenureYears === 'number' && sum.avgTenureYears >= 0, 'avg tenure'); ok(typeof sum.turnoverPct === 'number', 'turnover');
      ok(sum.active + sum.onLeave + sum.probation + sum.terminated === sum.total, 'status counts do not add up to total');
      return `workspace total ${sum.total}, active ${sum.active}, payroll ${sum.monthlyPayroll}, mine ${mine.length} (my basic ${myPay})`;
    });
  },
};
