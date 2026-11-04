// CRM account manager: leads (qualify / disqualify with reason), convert to account + contact + opportunity, opportunity stages,
// won / lost / reopen, finance customer on win, activities, accounts and contacts, pipeline and weighted pipeline checks, overview counts.
const { must, refused, eq, ok } = require('../lib');
const num = x => Number(x);

module.exports = {
  id: 'crm',
  title: 'CRM account manager',
  modules: ['crm'],
  role: 'sales',
  perms: ['crm.view', 'crm.leads.manage', 'crm.accounts.manage', 'crm.opps.manage', 'crm.activities.manage', 'crm.reports.view', 'crm.setup', 'finance.ar.view', 'finance.ar.manage'],
  probe: { path: '/api/erp/crm/records/lead', perm: 'crm.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, CO = u.ws.company;
    const API = p => `/api/erp/crm/${p}`;
    const rec = k => API(`records/${k}`);
    const list = async (k, qs = '') => must(await c.get(rec(k) + '?take=5000' + qs), 'list ' + k);
    const mineOpps = async () => (await list('opportunity')).filter(o => o.data && String(o.data.name || '').includes(K));
    const upd = (k, r, patch = {}) => c.put(rec(k) + '/' + r.id, { company: r.company, branch: r.branch, ref: r.ref, status: patch.status || r.status, data: { ...(r.data || {}), ...(patch.data || {}) } });
    const kp = (sm, k) => num(((sm.kpis || []).find(x => x.k === k) || {}).v);
    const rows = (sm, k) => ((sm.lists || []).find(x => x.k === k) || { rows: [] }).rows;
    const lead = (tag, extra = {}) => ({ company: CO, data: { name: `Person ${tag} ${K}`, company: `Company ${tag} ${K}`, email: `${tag.toLowerCase()}.${K.toLowerCase()}@example.com`, phone: '05' + u.tag + tag.length, source: 'Referral', industry: 'Healthcare', value: 10000, owner: u.username, ...extra } });

    await u.step('P09-01', 'CRM setup: pipeline stages and default VAT saved as defaults', async () => {
      const cfg = { stages: 'Qualified, Proposal, Negotiation', sources: 'Web, Referral, Event, Cold call, Partner, Campaign, Walk-in', taxPct: 15 };
      const d = (await list('setting')).find(x => x.code === 'defaults');
      if (d) must(await upd('setting', d, { data: cfg }), 'update defaults'); else must(await c.post(rec('setting'), { code: 'defaults', company: CO, status: 'Active', data: cfg }), 'create defaults');
      const back = (await list('setting')).find(x => x.code === 'defaults'); ok(/Negotiation/.test(back.data.stages), 'stages not stored'); eq(back.data.taxPct, 15, 'tax');
      return 'defaults saved';
    });

    await u.step('P09-02', 'Leads: four created (New, LD- numbers); two qualified, one disqualified with a reason, one edited and deleted', async () => {
      S.leads = {};
      for (const t of ['A', 'B', 'C', 'D']) { const r = must(await c.post(rec('lead'), lead(t, t === 'A' ? { value: 100000 } : t === 'B' ? { value: 40000, source: 'Web' } : {})), 'create lead ' + t); ok(r.status === 'New' && /^LD-/.test(r.code), `${r.code} ${r.status}`); S.leads[t] = r; }
      for (const t of ['A', 'B', 'C']) { const r = must(await upd('lead', S.leads[t], { status: 'Qualified' }), 'qualify ' + t); ok(r.status === 'Qualified', r.status); S.leads[t] = r; }
      const dq = must(await upd('lead', S.leads.D, { status: 'Unqualified', data: { reason: 'Budget too small', disqualifyReason: 'Budget too small' } }), 'disqualify'); ok(dq.status === 'Unqualified', dq.status); S.leads.D = dq;
      const back = (await list('lead')).find(x => x.id === dq.id); eq(back.data.reason === 'Budget too small' ? 1 : 0, 1, 'reason stored');
      const extra = must(await c.post(rec('lead'), lead('E')), 'extra lead'); const e2 = must(await upd('lead', extra, { data: { value: 12345 } }), 'edit'); eq(e2.data.value, 12345, 'edited value');
      must(await c.del(rec('lead') + '/' + extra.id), 'delete lead'); ok(!(await list('lead')).some(x => x.id === extra.id), 'deleted lead still listed');
      const mine = (await list('lead')).filter(x => x.data && String(x.data.name || '').includes(K)); eq(mine.filter(x => x.status === 'Qualified').length, 3, 'qualified'); eq(mine.filter(x => x.status === 'Unqualified').length, 1, 'unqualified');
      return 'Qualified 3, Unqualified 1 (reason kept)';
    });

    await u.step('P09-03', 'Convert qualified leads A and B: account + contact + opportunity (Open, Qualified 25%, amount as given); C without opportunity; converting again refused', async () => {
      ok(S.leads && S.leads.A, 'depends on P09-02');
      S.conv = {};
      for (const [t, amt] of [['A', 100000], ['B', 40000]]) {
        const cv = must(await c.post(API(`leads/${S.leads[t].id}/convert`), { createOpportunity: true, amount: amt }), 'convert ' + t); ok(cv.account && cv.contact && cv.opportunity, 'convert result incomplete');
        const op = (await list('opportunity')).find(x => x.code === cv.opportunity); ok(op, 'opportunity not found');
        ok(op.status === 'Open' && op.data.stage === 'Qualified', `opp ${op.status} ${op.data.stage}`); eq(op.data.probability, 25, 'initial probability'); eq(op.data.amount, amt, 'amount'); ok(op.data.account === cv.account, 'account link');
        const ac = (await list('account')).find(x => x.code === cv.account); eq(ac.data.name, `Company ${t} ${K}`, 'account name'); const ct = (await list('contact')).find(x => x.code === cv.contact); eq(ct.data.name, `Person ${t} ${K}`, 'contact name');
        S.conv[t] = { ...cv, opp: op };
      }
      const cvC = must(await c.post(API(`leads/${S.leads.C.id}/convert`), { createOpportunity: false }), 'convert C'); ok(cvC.account && cvC.contact && !cvC.opportunity, 'C should have no opportunity');
      const leads = await list('lead'); for (const t of ['A', 'B', 'C']) { const l = leads.find(x => x.id === S.leads[t].id); ok(l.status === 'Converted' && l.data.account, `lead ${t} ${l.status}`); }
      refused(await c.post(API(`leads/${S.leads.A.id}/convert`), { createOpportunity: true, amount: 1 }), 'second conversion', [400]);
      refused(await c.post(API('leads/no-such-lead-' + K + '/convert'), {}), 'unknown lead', [404]);
      return `accounts ${S.conv.A.account}/${S.conv.B.account}`;
    });

    await u.step('P09-04', 'Stages: A -> Proposal 50%, B -> Negotiation 75%, direct opportunity 20,000 at 20%; pipeline 160,000, weighted 84,000; nameless opportunity refused', async () => {
      ok(S.conv && S.conv.A && S.conv.B, 'depends on P09-03');
      refused(await c.post(rec('opportunity'), { company: CO, data: { amount: 5, stage: 'Qualified' } }), 'opportunity without name', [400]);
      const a = must(await upd('opportunity', S.conv.A.opp, { data: { name: 'Annual supply ' + K, stage: 'Proposal', probability: 50 } }), 'A -> Proposal');
      const b = must(await upd('opportunity', S.conv.B.opp, { data: { name: 'First order ' + K, stage: 'Negotiation', probability: 75 } }), 'B -> Negotiation');
      const o3 = must(await c.post(rec('opportunity'), { company: CO, ref: S.conv.A.account, data: { name: 'Direct deal ' + K, account: S.conv.A.account, amount: 20000, stage: 'Qualified', probability: 20, closeDate: u.ws.today, owner: u.username } }), 'direct opportunity');
      ok(o3.status === 'Open' && /^OP-/.test(o3.code), `${o3.code} ${o3.status}`); S.opp = { A: a, B: b, C: o3 };
      const my = await mineOpps(); eq(my.length, 3, 'my opportunities'); const open = my.filter(o => o.status === 'Open');
      eq(open.reduce((s, o) => s + num(o.data.amount), 0), 160000, 'pipeline'); eq(open.reduce((s, o) => s + num(o.data.amount) * num(o.data.probability) / 100, 0), 84000, 'weighted');
      const sm = must(await c.get(API('summary')), 'summary'); ok(kp(sm, 'pipeline') >= 160000 - 0.005, 'summary pipeline ' + kp(sm, 'pipeline')); ok(kp(sm, 'weighted') >= 84000 - 0.005, 'summary weighted ' + kp(sm, 'weighted')); ok(kp(sm, 'openCount') >= 3, 'openCount');
      const st = n => num((rows(sm, 'byStage').find(x => x.name === n) || {}).value || 0); ok(st('Proposal') >= 100000 && st('Negotiation') >= 40000 && st('Qualified') >= 20000, 'byStage ' + JSON.stringify(rows(sm, 'byStage')));
      if (kp(sm, 'openCount') === 3) { eq(kp(sm, 'pipeline'), 160000, 'pipeline (alone in workspace)'); eq(kp(sm, 'weighted'), 84000, 'weighted (alone)'); }
      return 'pipeline 160,000 / weighted 84,000';
    });

    await u.step('P09-05', 'Won: A -> Won 100%, finance customer created from the account; Lost with reason; reopen -> Negotiation 60%; pipeline falls to 40,000 (weighted 24,000)', async () => {
      ok(S.opp, 'depends on P09-04');
      const w = must(await c.post(API(`opportunities/${S.opp.A.id}/won`), {}), 'win'); ok(w.status === 'Won' && w.data.stage === 'Won', `${w.status} ${w.data.stage}`); eq(w.data.probability, 100, 'won probability');
      const fc = must(await c.get('/api/finance/records/customer'), 'finance customers').find(x => x.code === S.conv.A.account); ok(fc, 'finance customer was not created for the won account'); eq(fc.data.name, `Company A ${K}`, 'finance customer name');
      const l = must(await c.post(API(`opportunities/${S.opp.C.id}/lost`), { reason: 'Price too high' }), 'lose'); ok(l.status === 'Lost', l.status); eq(l.data.probability, 0, 'lost probability'); eq(l.data.lostReason === 'Price too high' ? 1 : 0, 1, 'lost reason');
      const l2 = must(await c.post(API(`opportunities/${S.opp.B.id}/lost`), { reason: 'Postponed' }), 'lose B'); ok(l2.status === 'Lost', l2.status);
      const re = must(await c.post(API(`opportunities/${S.opp.B.id}/reopen`), {}), 'reopen'); ok(re.status === 'Open' && re.data.stage === 'Negotiation', `${re.status} ${re.data.stage}`); eq(re.data.probability, 60, 'reopen probability');
      refused(await c.del(rec('opportunity') + '/' + S.opp.A.id), 'delete a won opportunity', [400]);
      refused(await c.post(API(`opportunities/${S.opp.A.id}/bogus`), {}), 'unknown result', [404]); refused(await c.post(API('opportunities/no-such-opp-' + K + '/won'), {}), 'unknown opportunity', [404]);
      const open = (await mineOpps()).filter(o => o.status === 'Open'); eq(open.length, 1, 'open'); eq(open.reduce((s, o) => s + num(o.data.amount), 0), 40000, 'pipeline'); eq(open.reduce((s, o) => s + num(o.data.amount) * num(o.data.probability) / 100, 0), 24000, 'weighted');
      return 'Won 100,000; open 40,000 weighted 24,000';
    });

    await u.step('P09-06', 'Activities: call Done (15 min), meeting overdue, task; timeline per opportunity; overdue shows in the overview', async () => {
      ok(S.conv && S.opp, 'depends on P09-03/04');
      const ac = S.conv.B.account, op = S.opp.B.code, y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      const call = must(await c.post(rec('activity'), { company: CO, ref: ac, data: { type: 'Call', subject: 'Call ' + K, opportunity: op, contact: S.conv.B.contact, due: u.ws.today, duration: 15, owner: u.username } }), 'call'); ok(call.status === 'Open' && /^ACT-/.test(call.code), `${call.code} ${call.status}`);
      const done = must(await upd('activity', call, { status: 'Done', data: { doneAt: u.ws.today } }), 'done'); ok(done.status === 'Done', done.status);
      must(await c.post(rec('activity'), { company: CO, ref: ac, data: { type: 'Meeting', subject: 'Meeting ' + K, opportunity: op, due: y, time: '14:00', duration: 60, owner: u.username } }), 'meeting');
      must(await c.post(rec('activity'), { company: CO, ref: ac, data: { type: 'Task', subject: 'Send brochure ' + K, opportunity: op, due: u.ws.today, owner: u.username } }), 'task');
      const tl = (await list('activity', '&ref=' + encodeURIComponent(ac))).filter(a => a.data.opportunity === op); eq(tl.length, 3, 'timeline'); eq(tl.filter(a => a.status === 'Done').length, 1, 'done'); eq(tl.filter(a => a.status === 'Open').length, 2, 'open');
      eq(tl.find(a => a.data.type === 'Call').data.duration, 15, 'duration');
      const sm = must(await c.get(API('summary')), 'summary'); ok(kp(sm, 'activitiesDue') >= 2, 'activitiesDue ' + kp(sm, 'activitiesDue'));
      return 'timeline 3 (1 done, 2 open)';
    });

    await u.step('P09-07', 'Accounts and contacts by hand: duplicate code refused, edit, contact linked to account, delete contact', async () => {
      const code = `ACC-${K}`;
      const ac = must(await c.post(rec('account'), { code, company: CO, data: { name: 'Direct account ' + K, industry: 'Retail', phone: '05' + u.tag, email: 'acc@example.com', owner: u.username } }), 'account');
      refused(await c.post(rec('account'), { code, company: CO, data: { name: 'dup' } }), 'duplicate account code', [409]);
      const up = must(await upd('account', ac, { data: { industry: 'Wholesale' } }), 'edit'); eq(up.data.industry === 'Wholesale' ? 1 : 0, 1, 'industry');
      const ct = must(await c.post(rec('contact'), { company: CO, ref: code, data: { name: 'Contact ' + K, email: 'ct@example.com', phone: '05' + u.tag, title: 'Buyer', account: code } }), 'contact'); ok(/^CT-/.test(ct.code), ct.code);
      ok((await list('contact', '&ref=' + code)).some(x => x.id === ct.id), 'contact not listed by account');
      must(await c.del(rec('contact') + '/' + ct.id), 'delete contact'); ok(!(await list('contact')).some(x => x.id === ct.id), 'contact still listed');
      return code;
    });

    await u.step('P09-08', 'Overview: lead status counts and sources, win rate, won this month', async () => {
      const sm = must(await c.get(API('summary')), 'summary'); const cnt = (k, n) => num((rows(sm, k).find(x => x.name === n) || {}).value || 0);
      ok(cnt('leadsByStatus', 'Converted') >= 3, 'Converted leads'); ok(cnt('leadsByStatus', 'Unqualified') >= 1, 'Unqualified leads'); ok(cnt('bySource', 'Referral') >= 3 && cnt('bySource', 'Web') >= 1, 'lead sources');
      ok(kp(sm, 'wonMonth') >= 100000 - 0.005, 'wonMonth ' + kp(sm, 'wonMonth'));
      const wr = kp(sm, 'winRate'); ok(wr > 0 && wr < 100, 'winRate ' + wr);
      ok(rows(sm, 'topOpen').some(x => x.name === 'First order ' + K && num(x.value) === 40000), 'topOpen lacks my open opportunity');
      return `winRate ${wr}%, wonMonth ${kp(sm, 'wonMonth')}`;
    });

    await u.step('P09-09', 'Lists and refusals: unknown kind / bad module action refused; status filter works', async () => {
      refused(await c.get(rec('nothing')), 'unknown kind', [404]); refused(await c.post(API('workorders/x/release')), 'mfg action in crm', [404]);
      const q = must(await c.get(rec('lead') + '?status=Converted&take=5000'), 'filter'); ok(q.length >= 3 && q.every(x => x.status === 'Converted'), 'status filter');
      const dq = must(await c.get(rec('lead') + '?status=Unqualified&take=5000'), 'filter 2'); ok(dq.some(x => x.id === S.leads.D.id), 'disqualified lead not in filter');
      return 'ok';
    });

    await u.step('P09-10', 'Lead follow-up: New -> Contacted -> Qualified, owner reassigned, value raised; "new leads" count drops when it leaves New', async () => {
      const l = must(await c.post(rec('lead'), lead('F', { value: 5000 })), 'create lead F'); ok(l.status === 'New', l.status);
      ok(kp(must(await c.get(API('summary')), 'summary'), 'leadsNew') >= 1, 'new leads count must include it');
      let cur = must(await upd('lead', l, { status: 'Contacted', data: { lastContact: u.ws.today } }), 'contacted'); ok(cur.status === 'Contacted', cur.status);
      cur = must(await upd('lead', cur, { status: 'Qualified', data: { owner: 'someone.else', value: 8000 } }), 'qualified'); ok(cur.status === 'Qualified', cur.status);
      const back = (await list('lead')).find(x => x.id === l.id); eq(back.data.value, 8000, 'value'); ok(back.data.owner === 'someone.else' && back.data.lastContact === u.ws.today, 'owner / contact date kept');
      must(await c.del(rec('lead') + '/' + l.id), 'delete'); ok(!(await list('lead')).some(x => x.id === l.id), 'still listed');
      return 'follow-up ok';
    });
  },
};
