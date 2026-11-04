// Collaboration user: calendar (meetings single / weekly / instant, reminders, RSVP, free-busy, ICS, Jitsi link, to-dos), record chatter, files,
// saved filters and workflow tasks. Prayer times and Quran are browser-only (no API) and are listed as manual checks.
const { must, refused, eq, ok, addDays } = require('../lib');

module.exports = {
  id: 'collab-calendar-muslim',
  title: 'Collaboration, calendar and Muslim tools',
  modules: ['cal', 'collab', 'tasks', 'mus'],
  role: 'employee',
  perms: ['cal.*', 'mus.*', 'crm.view'],
  probe: { path: '/api/calendar/settings', perm: 'cal.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, ws = u.ws, admin = ws.admin, ADM = ws.admin.name;
    // own time slot (Riyadh local, UTC+3): hour 4..21 by user number, 10 days from now, so users do not collide
    const day = addDays(ws.today, 10), hh = String(4 + (u.n % 18)).padStart(2, '0');
    const at = (d, h, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`).toISOString();
    const START = at(day, hh), END = at(day, hh, 45);
    const compact = iso => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const events = async (cl, from, to) => must(await cl.get(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), 'events');
    const around = (iso, hrsBefore = 1, daysAfter = 1) => [new Date(Date.parse(iso) - hrsBefore * 3600e3).toISOString(), new Date(Date.parse(iso) + daysAfter * 86400e3).toISOString()];
    // a colleague with no calendar administration right, who is neither the owner nor invited (found through its own privileges)
    let outsider = null;
    const findOutsider = async () => {
      for (let i = 1; i < ws.clients.length; i++) {
        const x = ws.clients[i]; if (!x || i === u.n) continue;
        const me = await x.get('/api/users/me'); const eff = (me.ok && (me.data.effectivePermissions || me.data.permissions)) || [];
        if (eff.includes('cal.meetings.join') && eff.includes('cal.view') && !eff.includes('cal.settings')) return x;
      }
      return null;
    };
    const meet = (extra = {}) => ({ kind: 'meeting', title: 'Design review ' + K, start: START, end: END, attendees: [ADM], guests: [`guest.${K.toLowerCase()}@example.com`], remindMinutes: 15, notes: 'Agenda ' + K, ...extra });

    await u.step('COL-01', 'Meeting at my slot with an invited colleague and an outside guest: room, 45 minutes, reminder 15, status Scheduled', async () => {
      const r = must(await c.post('/api/calendar/events', meet()), 'create meeting');
      const ev = r.ev; S.m = ev;
      eq(ev.kind, 'meeting', 'kind'); eq(ev.status, 'Scheduled', 'status'); ok(/^we-/.test(ev.room || ''), 'room ' + ev.room);
      eq((new Date(ev.end) - new Date(ev.start)) / 60000, 45, 'minutes'); eq(new Date(ev.start).toISOString(), START, 'start');
      eq(ev.data.remind, 15, 'reminder'); ok(ev.data.attendees.includes(ADM), 'attendee'); ok(ev.data.guests.length === 1, 'guest');
      eq(ev.owner, u.username, 'owner');
      const mine = (await events(c, ...around(START))).filter(e => e.id === ev.id); eq(mine.length, 1, 'in my calendar');
      return `room ${ev.room}, emailed ${r.emailed}`;
    });

    await u.step('COL-02', 'Invalid meetings refused: no title, no start, end before start, unknown person, reminder 20,000 min, bad guest e-mail, longer than 31 days', async () => {
      refused(await c.post('/api/calendar/events', meet({ title: '  ' })), 'no title', [400]);
      refused(await c.post('/api/calendar/events', meet({ start: undefined, end: undefined })), 'no start', [400]);
      refused(await c.post('/api/calendar/events', meet({ end: at(day, hh, 0).replace(/T\d\d/, 'T00') })), 'end before start', [400]);
      refused(await c.post('/api/calendar/events', meet({ attendees: ['nobody-' + K] })), 'unknown person', [400]);
      refused(await c.post('/api/calendar/events', meet({ remindMinutes: 20000 })), 'reminder too long', [400]);
      refused(await c.post('/api/calendar/events', meet({ guests: ['not an address'] })), 'bad guest', [400]);
      refused(await c.post('/api/calendar/events', meet({ end: new Date(Date.parse(START) + 40 * 86400e3).toISOString() })), 'longer than 31 days', [400]);
      refused(await c.get(`/api/calendar/events?from=${encodeURIComponent(END)}&to=${encodeURIComponent(START)}`), 'range reversed', [400]);
      return '8 invalid requests refused';
    });

    await u.step('COL-03', 'RSVP: the invited colleague answers yes, then maybe; owner sees it; wrong answer and an uninvited answer refused', async () => {
      ok(S.m, 'depends on COL-01');
      must(await admin.post(`/api/calendar/events/${S.m.id}/rsvp`, { response: 'yes' }), 'yes');
      let ev = (await events(c, ...around(START))).find(e => e.id === S.m.id); eq(ev.data.rsvp[ADM], 'yes', 'answer yes');
      must(await admin.post(`/api/calendar/events/${S.m.id}/rsvp`, { response: 'maybe' }), 'maybe');
      ev = (await events(c, ...around(START))).find(e => e.id === S.m.id); eq(ev.data.rsvp[ADM], 'maybe', 'answer maybe');
      refused(await admin.post(`/api/calendar/events/${S.m.id}/rsvp`, { response: 'perhaps' }), 'bad answer', [400]);
      refused(await c.post(`/api/calendar/events/${S.m.id}/rsvp`, { response: 'yes' }), 'owner is not an attendee', [400]);
      return 'yes -> maybe';
    });

    await u.step('COL-04', 'Jitsi link: owner joins with https://<jitsi server>/<room>; invited colleague is told the room opens 15 min before; outsider refused', async () => {
      outsider = await findOutsider();
      ok(S.m, 'depends on COL-01');
      const set = must(await c.get('/api/calendar/settings'), 'settings'); ok(set.jitsiDomain, 'jitsi domain');
      const j = must(await c.post(`/api/calendar/events/${S.m.id}/join`, {}), 'owner joins');
      eq(j.url, `https://${set.jitsiDomain}/${S.m.room}`, 'join url'); eq(j.room, S.m.room, 'room'); eq(j.title, 'Design review ' + K, 'title');
      refused(await admin.post(`/api/calendar/events/${S.m.id}/join`, {}), 'join 10 days early', [400]);
      if (outsider) refused(await outsider.post(`/api/calendar/events/${S.m.id}/join`, {}), 'uninvited user joins', [403]);
      return j.url;
    });

    await u.step('COL-05', 'Weekly recurring meeting: 3 occurrences on the same weekday, 7 days apart, visible to the invitee; free/busy shows blocks without titles', async () => {
      const s2 = at(day, hh, 0), e2 = at(day, hh, 30);
      const until = new Date(Date.parse(s2) + 14 * 86400e3).toISOString();
      const r = must(await c.post('/api/calendar/events', { kind: 'meeting', title: 'Weekly sync ' + K, start: s2, end: e2, attendees: [ADM], repeat: 'weekly', repeatUntil: until, remindMinutes: 10 }), 'weekly');
      S.weekly = r.ev;
      for (const [name, cl] of [['me', c], ['colleague', admin]]) {
        const list = (await events(cl, new Date(Date.parse(s2) - 3600e3).toISOString(), new Date(Date.parse(s2) + 30 * 86400e3).toISOString())).filter(e => e.title === 'Weekly sync ' + K);
        eq(list.length, 3, 'occurrences for ' + name);
        const starts = list.map(e => Date.parse(e.start)); eq((starts[1] - starts[0]) / 86400e3, 7, 'gap'); eq((starts[2] - starts[1]) / 86400e3, 7, 'gap 2');
        ok(list.every(e => new Date(e.start).getUTCDay() === new Date(s2).getUTCDay()), 'weekday changes');
      }
      const fb = must(await c.post('/api/calendar/freebusy', { users: [u.username, ADM], from: new Date(Date.parse(s2) - 3600e3).toISOString(), to: new Date(Date.parse(s2) + 86400e3).toISOString() }), 'freebusy');
      for (const who of [u.username, ADM]) {
        ok(fb[who] && fb[who].some(b => new Date(b.s).toISOString() === s2 && new Date(b.e).toISOString() === e2), 'busy block missing for ' + who);
        ok(!JSON.stringify(fb[who]).includes('Weekly sync'), 'free/busy leaks the title');
      }
      refused(await c.post('/api/calendar/freebusy', { users: [u.username], from: s2, to: new Date(Date.parse(s2) + 90 * 86400e3).toISOString() }), 'free/busy over 60 days', [400]);
      return '3 weekly occurrences, busy block ' + compact(s2);
    });

    await u.step('COL-06', 'ICS export: DTSTART/DTEND are the exact UTC times, SUMMARY, meeting link, weekly RRULE with UNTIL; an outsider cannot download', async () => {
      outsider = await findOutsider();
      ok(S.m && S.weekly, 'depends on COL-01 / COL-05');
      const set = must(await c.get('/api/calendar/settings'), 'settings');
      const r = await c.get(`/api/calendar/events/${S.m.id}/ics`); ok(r.ok && typeof r.data === 'string', 'ics HTTP ' + r.status); const t = r.data;
      ok(t.startsWith('BEGIN:VCALENDAR') && t.includes('END:VEVENT'), 'not a calendar file');
      ok(t.includes('DTSTART:' + compact(START)), `DTSTART should be ${compact(START)}: ${(t.match(/DTSTART:[^\r\n]*/) || [''])[0]}`);
      ok(t.includes('DTEND:' + compact(END)), 'DTEND should be ' + compact(END));
      ok(t.includes('SUMMARY:Design review ' + K), 'SUMMARY'); ok(t.includes(`https://${set.jitsiDomain}/${S.m.room}`), 'meeting link missing');
      const w = (await c.get(`/api/calendar/events/${S.weekly.id}/ics`)).data;
      ok(/RRULE:FREQ=WEEKLY;UNTIL=\d{8}T235959Z/.test(w), 'weekly RRULE: ' + (w.match(/RRULE:[^\r\n]*/) || ['none'])[0]);
      const adm = await admin.get(`/api/calendar/events/${S.m.id}/ics`); ok(adm.ok, 'invited colleague gets the ics');
      if (outsider) refused(await outsider.get(`/api/calendar/events/${S.m.id}/ics`), 'uninvited ics', [403]);
      return 'DTSTART ' + compact(START);
    });

    await u.step('COL-07', 'Change then cancel a meeting: new title and time are visible; cancelled meeting disappears for both and cannot be joined', async () => {
      outsider = await findOutsider();
      const r = must(await c.post('/api/calendar/events', { kind: 'meeting', title: 'Temp ' + K, start: at(day, hh, 0), end: at(day, hh, 30), attendees: [ADM] }), 'create');
      const ns = new Date(Date.parse(START) + 3600e3).toISOString(), ne = new Date(Date.parse(END) + 3600e3).toISOString();
      const up = must(await c.put(`/api/calendar/events/${r.ev.id}`, { kind: 'meeting', title: 'Temp moved ' + K, start: ns, end: ne, attendees: [ADM] }), 'update');
      eq(up.ev.title, 'Temp moved ' + K, 'title'); eq(new Date(up.ev.start).toISOString(), ns, 'start'); eq(up.ev.room, r.ev.room, 'room unchanged');
      ok((await events(admin, ...around(ns))).some(e => e.id === r.ev.id && e.title === 'Temp moved ' + K), 'colleague sees the change');
      if (outsider) refused(await outsider.put(`/api/calendar/events/${r.ev.id}`, { kind: 'meeting', title: 'hijack', start: ns, end: ne }), 'outsider edits my meeting', [403, 404]);
      ok((await c.del(`/api/calendar/events/${r.ev.id}`)).status === 204, 'cancel');
      ok(!(await events(c, ...around(ns))).some(e => e.id === r.ev.id), 'cancelled meeting still listed for me');
      ok(!(await events(admin, ...around(ns))).some(e => e.id === r.ev.id), 'cancelled meeting still listed for colleague');
      refused(await c.post(`/api/calendar/events/${r.ev.id}/join`, {}), 'join cancelled', [400]);
      return 'moved +1 h then cancelled';
    });

    await u.step('COL-08', 'Instant meeting: link at once, 5 minutes is raised to 15, both people join the same room', async () => {
      outsider = await findOutsider();
      const r = must(await c.post('/api/calendar/meetings/instant', { title: 'Quick ' + K, attendees: [ADM], minutes: 5 }), 'instant');
      ok(/^https:\/\//.test(r.url), 'url ' + r.url); eq((new Date(r.ev.end) - new Date(r.ev.start)) / 60000, 15, 'minimum length');
      const a = must(await c.post(`/api/calendar/events/${r.ev.id}/join`, {}), 'owner joins'), b = must(await admin.post(`/api/calendar/events/${r.ev.id}/join`, {}), 'colleague joins');
      eq(a.room, b.room, 'same room'); eq(a.url, r.url, 'same link');
      if (outsider) refused(await outsider.post(`/api/calendar/events/${r.ev.id}/join`, {}), 'uninvited joins instant meeting', [403]);
      const d = must(await c.post('/api/calendar/meetings/instant', {}), 'instant without details'); ok(d.ev.title, 'default title'); eq((new Date(d.ev.end) - new Date(d.ev.start)) / 60000, 60, 'default 60 minutes');
      return a.room;
    });

    await u.step('COL-09', 'Reminders: 5 minutes, 0 minutes and none are stored as given', async () => {
      const mk = async (rem, h) => must(await c.post('/api/calendar/events', { kind: 'meeting', title: `Remind ${rem} ${K}`, start: at(day, h), end: at(day, h, 30), remindMinutes: rem }), 'remind ' + rem).ev;
      const a = await mk(5, 22), b = await mk(0, 23), n = await mk(undefined, 3);
      eq(a.data.remind, 5, 'five'); eq(b.data.remind, 0, 'zero'); ok(n.data.remind === null || n.data.remind === undefined, 'no reminder');
      return '5 / 0 / none';
    });

    await u.step('COL-10', 'Calendar event (all day, location) and to-do: created, listed only for me, marked done and open again, deleted', async () => {
      const e = must(await c.post('/api/calendar/events', { kind: 'event', title: 'Site visit ' + K, start: at(day, '00'), end: at(day, '23', 59), allDay: true, location: 'Jeddah ' + K }), 'event').ev;
      eq(e.data.location, 'Jeddah ' + K, 'location'); eq(e.data.allDay, true, 'all day');
      const t = must(await c.post('/api/calendar/events', { kind: 'todo', title: 'Prepare slides ' + K, start: at(day, hh), priority: 'high' }), 'todo').ev;
      eq(t.status, 'Open', 'todo open'); eq(t.data.priority, 'high', 'priority');
      ok((must(await c.get('/api/calendar/todos'), 'todos')).some(x => x.id === t.id), 'todo listed');
      ok(!(must(await admin.get('/api/calendar/todos'), 'admin todos')).some(x => x.id === t.id), 'my todo is visible to someone else');
      eq(must(await c.post(`/api/calendar/events/${t.id}/done`, {}), 'done').status, 'Done', 'done');
      eq(must(await c.post(`/api/calendar/events/${t.id}/done`, {}), 'reopen').status, 'Open', 'open again');
      refused(await admin.post(`/api/calendar/events/${t.id}/done`, {}), 'someone else completes my todo', [404]);
      ok((await c.del(`/api/calendar/events/${t.id}`)).status === 204, 'delete todo');
      ok(!(await c.get('/api/calendar/todos')).data.some(x => x.id === t.id), 'deleted todo still listed');
      refused(await c.post('/api/calendar/events', { kind: 'todo', title: '' }), 'todo without title', [400]);
      return 'event + todo flow';
    });

    const REC = `REC-${K}`;
    await u.step('COL-11', 'Chatter on a record: three notes, empty note refused, system log flagged, colleague admin sees and may delete', async () => {
      const base = `/api/collab/crm/lead/${REC}/notes`;
      const n1 = must(await c.post(base, { text: 'First note ' + K }), 'note 1'); const n2 = must(await c.post(base, { text: 'Second note ' + K }), 'note 2');
      const sys = must(await c.post(base, { text: 'Status changed ' + K, system: true }), 'system note'); eq(sys.system, true, 'system flag'); eq(n1.system, false, 'normal flag');
      refused(await c.post(base, { text: '   ' }), 'empty note', [400]);
      const l = must(await c.get(base), 'notes'); eq(l.length, 3, 'notes'); ok(l.some(x => x.text === 'Status changed ' + K && x.system), 'system note listed'); ok(l.every(x => x.author === u.username), 'author');
      const al = must(await admin.get(base), 'admin notes'); eq(al.length, 3, 'admin sees notes');
      ok((await c.del(`/api/collab/notes/${n1.id}`)).status === 204, 'delete own note');
      ok((await admin.del(`/api/collab/notes/${n2.id}`)).status === 204, 'admin deletes colleague note');
      eq(must(await c.get(base), 'notes again').length, 1, 'notes left');
      refused(await c.post(`/api/collab/nomodule/x/${REC}/notes`, { text: 'x' }), 'unknown module', [403]);
      return '3 notes, 2 deleted';
    });

    await u.step('COL-12', 'Attachments: upload a file, size is 11 bytes, download returns the same text, bad file refused, delete', async () => {
      const base = `/api/collab/crm/lead/${REC}/files`, text = 'hello world';
      const f = must(await c.post(base, { name: `note-${K}.txt`, type: 'text/plain', content: Buffer.from(text).toString('base64') }), 'upload');
      eq(f.size, 11, 'size'); eq(f.name, `note-${K}.txt`, 'name');
      refused(await c.post(base, { name: 'bad.txt', content: '***not base64***' }), 'bad base64', [400]);
      refused(await c.post(base, { name: '', content: 'aGk=' }), 'no name', [400]);
      ok(must(await c.get(base), 'files').some(x => x.id === f.id), 'file listed');
      const d = await c.get(`/api/collab/files/${f.id}`); ok(d.ok, 'download HTTP ' + d.status); eq(d.text, text, 'downloaded content');
      ok((await c.del(`/api/collab/files/${f.id}`)).status === 204, 'delete'); ok(!(must(await c.get(base), 'files again')).some(x => x.id === f.id), 'deleted file listed');
      return 'upload / download / delete';
    });

    await u.step('COL-13', 'Saved filters: private filter is mine only, shared filter is seen by the admin, delete works', async () => {
      const view = `list-${K}`;
      const p = must(await c.post(`/api/collab/configs/filter?view=${view}`, { name: 'Mine ' + K, shared: false, data: { status: 'Active' } }), 'private');
      const s = must(await c.post(`/api/collab/configs/filter?view=${view}`, { name: 'Team ' + K, shared: true, data: { status: 'Open' } }), 'shared');
      eq(must(await c.get(`/api/collab/configs/filter?view=${view}`), 'mine').length, 2, 'my filters');
      const a = must(await admin.get(`/api/collab/configs/filter?view=${view}`), 'admin filters'); eq(a.length, 1, 'admin sees the shared one only'); eq(a[0].name, 'Team ' + K, 'shared name');
      refused(await c.post(`/api/collab/configs/filter?view=${view}`, { name: '', data: {} }), 'unnamed filter', [400]);
      ok((await c.del(`/api/collab/configs/filter/${p.id}`)).status === 204, 'delete private'); ok((await c.del(`/api/collab/configs/filter/${s.id}`)).status === 204, 'delete shared');
      return 'private + shared';
    });

    await u.step('COL-14', 'Workflow tasks: my task list loads; completing without a decision or a task that does not exist is refused', async () => {
      const t = must(await c.get('/api/tasks'), 'tasks'); ok(Array.isArray(t), 'task list is not an array');
      refused(await c.post(`/api/tasks/none-${K}/complete`, { decision: '' }), 'no decision', [400]);
      refused(await c.post(`/api/tasks/none-${K}/complete`, { decision: 'Approve' }), 'unknown task', [400, 404]);
      return `${t.length} open task(s)`;
    });

    u.manual('COL-15', 'Muslim > Times: prayer times for Riyadh (Umm al-Qura) and Jeddah', 'Prayer times are computed in the browser (no API): check five prayers in order, countdown, Hijri date, Jeddah about 30 minutes later than Riyadh, method switch changes Fajr/Isha.');
    u.manual('COL-16', 'Muslim > Quran: Surah 112 with translation and audio', 'Uses an external Quran API and audio (internet needed): four verses in Arabic with English translation, audio of verse 1, clear offline message.');
  },
};
