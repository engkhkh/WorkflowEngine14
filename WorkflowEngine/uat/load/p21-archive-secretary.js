// Archive & Secretary (module arc): categories + retention, incoming/outgoing mail with approval, archive with legal hold and disposal,
// confidentiality, appointments (clash rules), visitors (badges), to-dos, overview.
const { must, refused, eq, ok, addDays } = require('../lib');
const { Client } = require('../lib');

module.exports = {
  id: 'archive-secretary',
  title: 'Secretary / archivist',
  modules: ['arc'],
  role: 'secretary',
  perms: ['arc.view', 'arc.incoming.manage', 'arc.outgoing.manage', 'arc.docs.manage', 'arc.secretary.manage', 'arc.reports.view'],   // no approve, no confidential, no dispose, no setup
  probe: { path: '/api/erp/arc/records/incoming', perm: 'arc.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, ws = u.ws, A = ws.admin, today = ws.today;
    const R = kind => `/api/erp/arc/records/${kind}`;
    const ACT = (kind, id, op) => `/api/erp/arc/arcact/${kind}/${id}/${op}`;
    const list = async (cl, kind) => must(await cl.get(R(kind) + '?take=5000'), 'list ' + kind);
    const get = async (cl, kind, id) => { const r = (await list(cl, kind)).find(x => x.id === id); ok(r, `${kind} ${id} not found`); return r; };
    const create = async (cl, kind, body, what) => must(await cl.post(R(kind), Object.assign({ company: ws.company }, body)), what || 'create ' + kind);
    const act = async (cl, kind, id, op, body, what) => must(await cl.post(ACT(kind, id, op), body || {}), what || `${kind} ${op}`);
    const tryAct = (cl, kind, id, op, body) => cl.post(ACT(kind, id, op), body || {});
    const msg = r => (typeof r.data === 'string' ? r.data : (r.data && (r.data.message || r.data.title)) || r.text || '');
    const CAT = `CAT-${K}`, CAT0 = `CAT0-${K}`;
    const letter = (n, extra) => ({ data: Object.assign({ subject: `Letter ${n} ${K}`, sender: `Ministry ${K}`, senderRef: `REF-${K}-${n}`, receivedDate: today, channel: 'Mail', category: CAT }, extra || {}) });

    await u.step('ARC-01', 'Categories (set up by the admin): 1-year and keep-forever; the secretary cannot create one', async () => {
      const a = must(await A.post(R('category'), { company: ws.company, code: CAT, data: { name: `Contracts ${K}`, nameAr: 'عقود', retentionYears: 1 } }), 'category 1y');
      eq(a.status, 'Active', 'category status'); eq(a.data.retentionYears, 1, 'retention');
      must(await A.post(R('category'), { company: ws.company, code: CAT0, data: { name: `Deeds ${K}`, retentionYears: 0 } }), 'category forever');
      refused(await c.post(R('category'), { company: ws.company, code: 'X' + K, data: { name: 'x', retentionYears: 1 } }), 'secretary creates a category', [403]);
      refused(await A.post(R('category'), { company: ws.company, code: 'N' + K, data: { name: 'x', retentionYears: -1 } }), 'negative retention', [400]);
      refused(await A.post(R('category'), { company: ws.company, code: CAT, data: { name: 'dup', retentionYears: 1 } }), 'duplicate category code', [409]);
      const seen = await list(c, 'category'); ok(seen.some(x => x.code === CAT), 'secretary cannot read the categories');
      return '2 categories';
    });

    await u.step('ARC-02', 'Register an incoming letter: auto number IN-, status Received, defaults Normal / Internal', async () => {
      const r = await create(c, 'incoming', letter(1), 'register letter');
      ok(/^IN-/.test(r.code), 'number ' + r.code); eq(r.status, 'Received', 'status');
      eq(r.data.priority, 'Normal', 'default priority'); eq(r.data.confidentiality, 'Internal', 'default confidentiality');
      S.in1 = r; return r.code;
    });

    await u.step('ARC-03', 'Incoming letter rules: subject, sender, future date, due before received, unknown category, duplicate reference, bad channel', async () => {
      const bad = async (data, why, codes = [400]) => { const r = await c.post(R('incoming'), { company: ws.company, data: Object.assign({}, letter(9).data, { senderRef: `BAD-${K}-${Math.random()}` }, data) }); refused(r, why, codes); return msg(r); };
      await bad({ subject: '' }, 'no subject'); await bad({ sender: '' }, 'no sender');
      await bad({ receivedDate: addDays(today, 10) }, 'received in the future');
      await bad({ dueDate: addDays(today, -3) }, 'due before received');
      const m = await bad({ category: 'NOPE-' + K }, 'unknown category'); ok(/NOPE/.test(m) || /category/i.test(m), 'message names the category: ' + m);
      await bad({ channel: 'Pigeon' }, 'bad channel'); await bad({ priority: 'Whenever' }, 'bad priority'); await bad({ confidentiality: 'Top' }, 'bad confidentiality');
      const dup = await c.post(R('incoming'), { company: ws.company, data: letter(1).data });
      refused(dup, 'duplicate letter', [400]); ok(S.in1 && String(msg(dup)).includes(S.in1.code), 'duplicate message names ' + (S.in1 && S.in1.code) + ': ' + msg(dup));
      return 'all refused';
    });

    await u.step('ARC-04', 'Assign: unknown person refused; assign to myself with a due date -> Assigned, a to-do is created for me', async () => {
      ok(S.in1, 'depends on ARC-02');
      refused(await tryAct(c, 'incoming', S.in1.id, 'assign', { user: 'nobody-' + K }), 'assign to unknown user', [400]);
      refused(await tryAct(c, 'incoming', S.in1.id, 'assign', {}), 'assign nobody', [400]);
      refused(await tryAct(c, 'incoming', S.in1.id, 'assign', { user: u.username, due: addDays(today, -5) }), 'due before received', [400]);
      const r = await act(c, 'incoming', S.in1.id, 'assign', { user: u.username, due: addDays(today, 7) });
      eq(r.status, 'Assigned', 'status'); eq(r.data.assignedTo, u.username, 'assignedTo'); eq(r.data.dueDate, addDays(today, 7), 'due');
      const todos = await list(c, 'todo'); const td = todos.find(t => t.data.related === S.in1.code);
      ok(td, 'no to-do was created for the assignee'); eq(td.data.assignedTo, u.username, 'to-do assignee'); eq(td.status, 'Open', 'to-do status');
      S.todoFromLetter = td; return `${S.in1.code} -> ${u.username}; to-do ${td.code}`;
    });

    await u.step('ARC-05', 'Start (only the assignee), then Reply creates a draft outgoing letter linked to it; the letter becomes Replied', async () => {
      ok(S.in1, 'depends on ARC-02');
      const s = await act(c, 'incoming', S.in1.id, 'start'); eq(s.status, 'InProgress', 'status after start');
      refused(await tryAct(c, 'incoming', S.in1.id, 'start'), 'start twice', [400]);
      const r = await act(c, 'incoming', S.in1.id, 'reply'); eq(r.status, 'Replied', 'status'); ok(/^OUT-/.test(r.data.reply), 'reply code ' + r.data.reply);
      const out = (await list(c, 'outgoing')).find(o => o.code === r.data.reply); ok(out, 'draft not listed');
      eq(out.status, 'Draft', 'draft status'); eq(out.data.replyTo, S.in1.code, 'replyTo'); eq(out.data.recipient, `Ministry ${K}`, 'recipient = sender'); ok(/^Re: /.test(out.data.subject), 'subject ' + out.data.subject);
      refused(await tryAct(c, 'incoming', S.in1.id, 'reply'), 'second reply', [400]);
      S.out1 = out; return out.code;
    });

    await u.step('ARC-06', 'Outgoing approval: secretary cannot approve; the admin (another person) approves; only a draft is editable', async () => {
      ok(S.out1, 'depends on ARC-05');
      const body = { status: 'Draft', data: Object.assign({}, S.out1.data, { body: 'Dear Sir, thank you for your letter.' }) };
      must(await c.put(R('outgoing') + '/' + S.out1.id, body), 'edit draft');
      refused(await tryAct(c, 'outgoing', S.out1.id, 'approve'), 'secretary approves', [403]);
      refused(await tryAct(c, 'outgoing', S.out1.id, 'send'), 'send before approval', [400]);
      const ap = await act(A, 'outgoing', S.out1.id, 'approve'); eq(ap.status, 'Approved', 'status'); eq(ap.data.approvedBy, A.info.username, 'approvedBy');
      refused(await c.put(R('outgoing') + '/' + S.out1.id, body), 'edit after approval', [400]);
      return 'approved by ' + ap.data.approvedBy;
    });

    await u.step('ARC-07', 'Send, then archive the outgoing letter: a document DOC- is created with the category retention', async () => {
      ok(S.out1, 'depends on ARC-05');
      const s = await act(c, 'outgoing', S.out1.id, 'send'); eq(s.status, 'Sent', 'status'); ok(s.data.sentAt, 'sentAt');
      refused(await tryAct(c, 'outgoing', S.out1.id, 'send'), 'send twice', [400]);
      const a = await act(c, 'outgoing', S.out1.id, 'archive', { note: `Shelf A-${K}` }); eq(a.status, 'Archived', 'status'); ok(/^DOC-/.test(a.data.document), 'document ' + a.data.document);
      const doc = (await list(c, 'document')).find(d => d.code === a.data.document); ok(doc, 'document not listed');
      eq(doc.data.source, S.out1.code, 'source'); eq(doc.data.folder, `Shelf A-${K}`, 'folder'); eq(doc.data.retentionYears, 1, 'retention from category');
      eq(doc.data.retentionEnd, addDays(today, 0).replace(/^(\d{4})/, y => String(Number(y) + 1)), 'retention end = date + 1 year');
      refused(await c.del(R('outgoing') + '/' + S.out1.id), 'delete an archived letter', [400]);
      return doc.code;
    });

    await u.step('ARC-08', 'Close the incoming letter (replied), archive it; closed letters cannot be edited or deleted', async () => {
      ok(S.in1, 'depends on ARC-02');
      refused(await tryAct(c, 'incoming', S.in1.id, 'archive'), 'archive before closing', [400]);
      const cl = await act(c, 'incoming', S.in1.id, 'close'); eq(cl.status, 'Closed', 'status'); ok(cl.data.closedAt, 'closedAt');
      const cur = await get(c, 'incoming', S.in1.id);
      refused(await c.put(R('incoming') + '/' + S.in1.id, { status: 'Closed', data: Object.assign({}, cur.data, { subject: 'changed' }) }), 'edit closed letter', [400]);
      const ar = await act(c, 'incoming', S.in1.id, 'archive', { note: `Shelf B-${K}` }); eq(ar.status, 'Archived', 'status'); ok(/^DOC-/.test(ar.data.document), 'doc code');
      refused(await c.del(R('incoming') + '/' + S.in1.id), 'delete archived letter', [400]);
      return ar.data.document;
    });

    await u.step('ARC-09', 'Close without a reply needs a reason; a letter without category cannot be archived', async () => {
      const l = await create(c, 'incoming', letter(2, { category: '' }));
      refused(await tryAct(c, 'incoming', l.id, 'close'), 'close without reason', [400]);
      const cl = await act(c, 'incoming', l.id, 'close', { note: 'Information only' }); eq(cl.status, 'Closed', 'status'); eq(cl.data.closeNote, 'Information only', 'closeNote');
      const r = await tryAct(c, 'incoming', l.id, 'archive', {}); refused(r, 'archive without category', [400]); ok(/category/i.test(msg(r)), 'message: ' + msg(r));
      // a letter that was never handled can still be deleted
      const l3 = await create(c, 'incoming', letter(3)); must(await c.del(R('incoming') + '/' + l3.id), 'delete a Received letter');
      return 'ok';
    });

    await u.step('ARC-10', 'Document: retention end = date + years (category default or own), whole years only', async () => {
      const d1 = await create(c, 'document', { data: { title: `Lease ${K}`, category: CAT, docDate: '2024-03-15', folder: 'S1' } });
      eq(d1.data.retentionYears, 1, 'default from category'); eq(d1.data.retentionEnd, '2025-03-15', 'retention end');
      const d2 = await create(c, 'document', { data: { title: `Charter ${K}`, category: CAT, docDate: '2024-03-15', retentionYears: 5 } });
      eq(d2.data.retentionEnd, '2029-03-15', 'own retention');
      const d3 = await create(c, 'document', { data: { title: `Deed ${K}`, category: CAT0, docDate: '2020-01-01' } });
      eq(d3.data.retentionEnd, '', 'forever has no end'); ok(/^DOC-/.test(d3.code), 'code');
      refused(await c.post(R('document'), { company: ws.company, data: { title: 'x', category: CAT, docDate: today, retentionYears: 1.5 } }), 'fractional years', [400]);
      refused(await c.post(R('document'), { company: ws.company, data: { title: '', category: CAT, docDate: today } }), 'no title', [400]);
      refused(await c.post(R('document'), { company: ws.company, data: { title: 'x', category: '', docDate: today } }), 'no category', [400]);
      refused(await c.post(R('document'), { company: ws.company, data: { title: 'x', category: CAT } }), 'no date', [400]);
      S.dOld = d1; S.dForever = d3; S.dLong = d2; return 'dates exact';
    });

    await u.step('ARC-11', 'Legal hold: needs a reason, blocks destruction, release restores', async () => {
      ok(S.dOld, 'depends on ARC-10');
      refused(await tryAct(c, 'document', S.dOld.id, 'hold', {}), 'hold without reason', [400]);
      const h = await act(c, 'document', S.dOld.id, 'hold', { reason: 'Court case 17/' + K }); eq(h.status, 'Hold', 'status'); eq(h.data.holdReason, 'Court case 17/' + K, 'reason');
      refused(await tryAct(A, 'document', S.dOld.id, 'dispose', { reason: 'x' }), 'destroy under hold', [400]);
      refused(await tryAct(c, 'document', S.dOld.id, 'hold', { reason: 'again' }), 'hold twice', [400]);
      const r = await act(c, 'document', S.dOld.id, 'release'); eq(r.status, 'Active', 'status'); ok(!r.data.holdReason, 'reason cleared');
      return 'hold / release';
    });

    await u.step('ARC-12', 'Disposal: secretary refused; admin needs retention over, a reason; forever documents and early ones refused; destroyed is final', async () => {
      ok(S.dOld && S.dLong && S.dForever, 'depends on ARC-10');
      refused(await tryAct(c, 'document', S.dOld.id, 'dispose', { reason: 'old' }), 'secretary destroys', [403]);
      const early = await tryAct(A, 'document', S.dLong.id, 'dispose', { reason: 'early' }); refused(early, 'destroy before retention end', [400]); ok(/2029-03-15/.test(msg(early)), 'message names the end date: ' + msg(early));
      refused(await tryAct(A, 'document', S.dForever.id, 'dispose', { reason: 'forever' }), 'destroy a keep-forever document', [400]);
      refused(await tryAct(A, 'document', S.dOld.id, 'dispose', {}), 'destroy without reason', [400]);
      const d = await act(A, 'document', S.dOld.id, 'dispose', { reason: 'Retention over' }); eq(d.status, 'Destroyed', 'status'); eq(d.data.destroyedBy, A.info.username, 'destroyedBy'); ok(d.data.destroyedAt, 'destroyedAt');
      const cur = await get(c, 'document', S.dOld.id);
      refused(await c.put(R('document') + '/' + S.dOld.id, { status: 'Destroyed', data: Object.assign({}, cur.data, { title: 'changed' }) }), 'edit destroyed', [400]);
      refused(await c.del(R('document') + '/' + S.dOld.id), 'delete destroyed', [400]);
      refused(await tryAct(A, 'document', S.dOld.id, 'dispose', { reason: 'again' }), 'destroy twice', [400]);
      return 'destroyed ' + S.dOld.code;
    });

    await u.step('ARC-13', 'Status cannot be forged: setting Closed / Sent / Destroyed through a plain edit is refused', async () => {
      const l = await create(c, 'incoming', letter(4));
      refused(await c.put(R('incoming') + '/' + l.id, { status: 'Closed', data: l.data }), 'close by edit', [400]);
      refused(await c.post(R('incoming'), { company: ws.company, status: 'Archived', data: letter(5).data }), 'create as Archived', [400]);
      const o = await create(c, 'outgoing', { data: { subject: 'S', recipient: 'R', date: today } });
      refused(await c.put(R('outgoing') + '/' + o.id, { status: 'Sent', data: o.data }), 'send by edit', [400]);
      const e = await c.put(R('incoming') + '/' + l.id, { status: 'Received', data: Object.assign({}, l.data, { assignedTo: 'someone', document: 'DOC-1' }) });
      if (e.ok) { const back = await get(c, 'incoming', l.id); ok(!back.data.assignedTo && !back.data.document, 'server-managed fields (assignedTo / document) must not be settable by edit'); }
      return 'blocked';
    });

    await u.step('ARC-14', 'Confidentiality: a Secret letter is invisible to a user without arc.confidential; admin sees it; the creator sees it', async () => {
      const sec = await create(c, 'incoming', letter(6, { confidentiality: 'Secret', subject: `Secret ${K}` }));
      const pub = await create(c, 'incoming', letter(7, { confidentiality: 'Public', subject: `Public ${K}` }));
      ok((await list(c, 'incoming')).some(x => x.id === sec.id), 'creator cannot see own Secret letter');
      ok((await list(A, 'incoming')).some(x => x.id === sec.id), 'admin (arc.confidential) cannot see it');
      // an outsider with arc.view only
      const un = `${u.username}o`;
      const perms = [...new Set([...(ws.roleDefaults.employee || []), 'arc.view', 'arc.incoming.manage'])];
      const mkU = await A.post('/api/users/admin', { username: un, displayName: 'Outsider ' + K, role: 'employee', password: require('./core').PASSWORD, permissions: perms, isActive: true });
      if (!mkU.ok && mkU.status === 402) return 'skipped: plan limit reached before the outsider could be created';
      must(mkU, 'create outsider');
      const o = new Client(un); await o.login(un, require('./core').PASSWORD);
      const seen = await list(o, 'incoming');
      ok(!seen.some(x => x.id === sec.id), 'outsider sees a Secret letter'); ok(seen.some(x => x.id === pub.id), 'outsider cannot see a Public letter');
      refused(await o.put(R('incoming') + '/' + sec.id, { status: 'Received', data: sec.data }), 'outsider edits Secret letter', [404]);
      refused(await tryAct(o, 'incoming', sec.id, 'close', { note: 'x' }), 'outsider acts on Secret letter', [404]);
      refused(await o.del(R('incoming') + '/' + sec.id), 'outsider deletes Secret letter', [404]);
      return 'Secret hidden from ' + un;
    });

    await u.step('ARC-15', 'Appointments: clash refused, adjacent allowed, end before start / bad time refused, finished cannot be edited, cancel frees the slot', async () => {
      const date = addDays(today, 3 + (u.n % 20));
      const apt = (title, s, e, extra) => ({ data: Object.assign({ title: `${title} ${K}`, with: 'Dr. Ali', date, startTime: s, endTime: e, location: 'Office' }, extra || {}) });
      const a1 = await create(c, 'appointment', apt('Board prep', '10:00', '11:00')); ok(/^APT-/.test(a1.code), 'code'); eq(a1.status, 'Scheduled', 'status'); eq(a1.data.owner, u.username, 'owner defaults to creator');
      const clash = await c.post(R('appointment'), Object.assign({ company: ws.company }, apt('Clash', '10:30', '11:30'))); refused(clash, 'clash', [400]); ok(msg(clash).includes(a1.code), 'message names ' + a1.code + ': ' + msg(clash));
      const a2 = await create(c, 'appointment', apt('Next', '11:00', '11:30')); ok(a2.id, 'adjacent appointment allowed');
      refused(await c.post(R('appointment'), Object.assign({ company: ws.company }, apt('Backwards', '15:00', '14:00'))), 'end before start', [400]);
      refused(await c.post(R('appointment'), Object.assign({ company: ws.company }, apt('Format', '9am', '10am'))), 'bad time format', [400]);
      refused(await c.post(R('appointment'), Object.assign({ company: ws.company }, apt('No title', '12:00', '13:00', { title: '' }))), 'no title', [400]);
      must(await c.put(R('appointment') + '/' + a1.id, { status: 'Cancelled', data: a1.data }), 'cancel');
      const again = await create(c, 'appointment', apt('Reuse slot', '10:00', '10:45')); ok(again.id, 'cancelled slot is free again');
      const done = must(await c.put(R('appointment') + '/' + a2.id, { status: 'Done', data: a2.data }), 'complete'); eq(done.status, 'Done', 'status');
      refused(await c.put(R('appointment') + '/' + a2.id, { status: 'Scheduled', data: a2.data }), 'reopen finished', [400]);
      return 'rules hold';
    });

    await u.step('ARC-16', 'Visitors: badge required, one badge inside at a time, check-out, cancel', async () => {
      const v = (n) => ({ data: { name: `Visitor ${n} ${K}`, company: 'ACME', purpose: 'Meeting', host: u.username, date: today } });
      const v1 = await create(c, 'visitor', v(1)); ok(/^VIS-/.test(v1.code), 'code'); eq(v1.status, 'Expected', 'status');
      refused(await c.post(R('visitor'), { company: ws.company, data: { name: '', purpose: 'x', date: today } }), 'no name', [400]);
      refused(await c.post(R('visitor'), { company: ws.company, data: { name: 'A', purpose: '', date: today } }), 'no purpose', [400]);
      refused(await tryAct(c, 'visitor', v1.id, 'checkin', {}), 'check in without badge', [400]);
      const inn = await act(c, 'visitor', v1.id, 'checkin', { badge: `B-${K}` }); eq(inn.status, 'In', 'status'); ok(inn.data.checkInAt, 'checkInAt');
      const v2 = await create(c, 'visitor', v(2));
      const same = await tryAct(c, 'visitor', v2.id, 'checkin', { badge: `B-${K}` }); refused(same, 'badge already in use', [400]); ok(/B-/.test(msg(same)), 'message names the badge');
      const out = await act(c, 'visitor', v1.id, 'checkout'); eq(out.status, 'Out', 'status'); ok(out.data.checkOutAt, 'checkOutAt');
      const ok2 = await act(c, 'visitor', v2.id, 'checkin', { badge: `B-${K}` }); eq(ok2.status, 'In', 'badge free after check-out');
      refused(await tryAct(c, 'visitor', v2.id, 'cancel'), 'cancel a visitor who is inside', [400]);
      const v3 = await create(c, 'visitor', v(3)); const cx = await act(c, 'visitor', v3.id, 'cancel'); eq(cx.status, 'Cancelled', 'status');
      refused(await c.del(R('visitor') + '/' + v1.id), 'delete a visitor who came', [400]);
      return 'badge ' + `B-${K}`;
    });

    await u.step('ARC-17', 'To-dos: create, start, done sets completedAt, reopen clears it, bad priority / empty title refused', async () => {
      const t = await create(c, 'todo', { data: { title: `Call the bank ${K}`, assignedTo: u.username, due: addDays(today, 2), priority: 'High' } });
      ok(/^TD-/.test(t.code), 'code'); eq(t.status, 'Open', 'status');
      refused(await c.post(R('todo'), { company: ws.company, data: { title: '' } }), 'no title', [400]);
      refused(await c.post(R('todo'), { company: ws.company, data: { title: 'x', priority: 'Whenever' } }), 'bad priority', [400]);
      const p = must(await c.put(R('todo') + '/' + t.id, { status: 'InProgress', data: t.data }), 'start'); eq(p.status, 'InProgress', 'status');
      const d = must(await c.put(R('todo') + '/' + t.id, { status: 'Done', data: p.data }), 'done'); ok(d.data.completedAt, 'completedAt set');
      const re = must(await c.put(R('todo') + '/' + t.id, { status: 'Open', data: d.data }), 'reopen'); ok(!re.data.completedAt, 'completedAt cleared');
      if (S.todoFromLetter) { const done = must(await c.put(R('todo') + '/' + S.todoFromLetter.id, { status: 'Done', data: S.todoFromLetter.data }), 'finish the letter to-do'); ok(done.data.completedAt, 'letter to-do completed'); }
      return t.code;
    });

    await u.step('ARC-18', 'Overview numbers include my work; the unassigned / overdue counters react', async () => {
      const before = must(await c.get('/api/erp/arc/summary'), 'summary'); const kv = s => Object.fromEntries(s.kpis.map(k => [k.k, k.v]));
      for (const k of ['incomingOpen', 'incomingOverdue', 'urgent', 'unassigned', 'outgoingPending', 'documents', 'retentionDue', 'onHold', 'appointmentsToday', 'visitorsIn', 'todosOpen', 'todosOverdue']) ok(k in kv(before), 'KPI ' + k + ' missing');
      const l = await create(c, 'incoming', letter(8, { priority: 'Urgent', subject: `Urgent ${K}` }));
      const after = must(await c.get('/api/erp/arc/summary'), 'summary 2');
      ok(kv(after).unassigned >= kv(before).unassigned + 1, 'unassigned did not grow'); ok(kv(after).urgent >= kv(before).urgent + 1, 'urgent did not grow'); ok(kv(after).incomingOpen >= kv(before).incomingOpen + 1, 'open did not grow');
      const cats = after.lists.find(x => x.k === 'docsByCategory'); ok(cats && cats.rows.some(r => r.name === CAT), 'documents by category lacks ' + CAT);
      ok(after.lists.some(x => x.k === 'incomingByStatus') && after.lists.some(x => x.k === 'outgoingByStatus'), 'status lists missing');
      return `open ${kv(after).incomingOpen}, unassigned ${kv(after).unassigned}, documents ${kv(after).documents}`;
    });

    await u.step('ARC-19', 'A category in use cannot be deleted; an unused one can; people without arc.view are refused', async () => {
      refused(await A.del(R('category') + '/' + (await list(A, 'category')).find(x => x.code === CAT).id), 'delete category in use', [400]);
      const tmp = must(await A.post(R('category'), { company: ws.company, code: 'TMP-' + K, data: { name: 'tmp', retentionYears: 2 } }), 'tmp category');
      must(await A.del(R('category') + '/' + tmp.id), 'delete unused category');
      const nobody = `${u.username}n`;
      const mkU = await A.post('/api/users/admin', { username: nobody, displayName: 'Nobody ' + K, role: 'employee', password: require('./core').PASSWORD, permissions: ['dashboard.view'], isActive: true });
      if (!mkU.ok) return 'category rules ok; no-privilege check skipped (' + mkU.status + ')';
      const n = new Client(nobody); await n.login(nobody, require('./core').PASSWORD);
      refused(await n.get(R('incoming')), 'no privilege reads incoming', [403]); refused(await n.get('/api/erp/arc/summary'), 'no privilege reads summary', [403]);
      refused(await n.post(R('incoming'), { company: ws.company, data: letter(9).data }), 'no privilege registers a letter', [403]);
      return 'ok';
    });

    u.manual('ARC-M1', 'Open an archive document, attach a scanned PDF in Notes & files, download it again', 'attachments go through Collab (browser)');
    u.manual('ARC-M2', 'Print the incoming register with the report designer (printer button)', 'print layout is browser-only');
  },
};
