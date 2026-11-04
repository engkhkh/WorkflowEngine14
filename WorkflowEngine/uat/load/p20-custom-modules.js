// Custom-module designer: own "Visitors-<key>" module from the assistant's template, fields, required rules, typed validation, records, rename, delete.
const { must, refused, eq, ok } = require('../lib');

module.exports = {
  id: 'custom-modules',
  title: 'Custom module designer',
  modules: ['cus'],
  role: 'employee',
  perms: ['cus.*'],
  probe: { path: '/api/custom/modules', perm: 'cus.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state, ws = u.ws;
    const TITLE = `Visitors-${K}`;
    const TEMPLATE = [
      { key: '', label: 'Visitor name', labelAr: 'اسم الزائر', type: 'text', required: true },
      { key: '', label: 'Company', labelAr: 'الشركة', type: 'text', required: false },
      { key: '', label: 'Phone', labelAr: 'الجوال', type: 'phone', required: false },
      { key: '', label: 'Host', labelAr: 'المضيف', type: 'text', required: false },
      { key: '', label: 'Visit date', labelAr: 'تاريخ الزيارة', type: 'date', required: false },
      { key: '', label: 'Purpose', labelAr: 'الغرض', type: 'textarea', required: false },
      { key: '', label: 'Status', labelAr: 'الحالة', type: 'select', required: false, options: ['Expected', 'In', 'Out'] },
    ];
    const keep = fields => fields.map(f => ({ key: f.key, label: f.label, labelAr: f.labelAr, type: f.type, required: !!f.required, options: f.options }));
    const modules = async () => must(await c.get('/api/custom/modules'), 'modules');
    const mine = async () => (await modules()).find(m => m.key === S.key);
    const putDef = async (fields, title = TITLE) => must(await c.put(`/api/custom/modules/${S.key}`, { title, icon: 'users', color: '#0ea5e9', fields }), 'update definition');
    const fk = (def, label) => { const f = def.fields.find(x => x.label === label); ok(f, `field "${label}" missing`); return f.key; };
    const records = async () => must(await c.get(`/api/custom/records/${S.key}`), 'records');

    await u.step('CUS-01', 'Create my module "Visitors-<key>" from the template: 7 fields, key from the name, listed in the menu', async () => {
      const r = must(await c.post('/api/custom/modules', { title: TITLE, icon: 'users', color: '#0ea5e9', fields: TEMPLATE }), 'create module');
      S.key = r.key; ok(/^visitors-/.test(r.key), 'module key ' + r.key);
      eq(r.def.fields.length, 7, 'fields'); eq(r.def.title, TITLE, 'title');
      eq(fk(r.def, 'Visitor name'), 'visitor-name', 'field key'); ok(r.def.fields.find(f => f.label === 'Visitor name').required === true, 'name required');
      eq(r.def.fields.find(f => f.label === 'Status').options.length, 3, 'options');
      const listed = (await modules()).find(m => m.key === r.key); ok(listed, 'module not in the menu list'); eq(listed.def.title, TITLE, 'menu title');
      ok((await ws.admin.get('/api/custom/modules')).data.some(m => m.key === r.key), 'workspace admin does not see the module');
      return 'module ' + r.key;
    });

    await u.step('CUS-02', 'Invalid definitions refused: no name, no fields, unknown type, list without options, unnamed field, 41 fields', async () => {
      const post = body => c.post('/api/custom/modules', body);
      const f1 = [{ label: 'A', type: 'text' }];
      refused(await post({ title: '', fields: f1 }), 'no name', [400]);
      refused(await post({ title: 'X ' + K, fields: [] }), 'no fields', [400]);
      refused(await post({ title: 'X ' + K, fields: [{ label: 'A', type: 'colour' }] }), 'unknown type', [400]);
      refused(await post({ title: 'X ' + K, fields: [{ label: 'A', type: 'select', options: [] }] }), 'list without options', [400]);
      refused(await post({ title: 'X ' + K, fields: [{ label: '', type: 'text' }] }), 'unnamed field', [400]);
      refused(await post({ title: 'X ' + K, fields: Array.from({ length: 41 }, (_, i) => ({ label: 'F' + i, type: 'text' })) }), '41 fields', [400]);
      refused(await post({ title: 'N'.repeat(81), fields: f1 }), 'name over 80 characters', [400]);
      ok(!(await modules()).some(m => m.key !== S.key && /^x-/.test(m.key) && m.def.title.endsWith(K)), 'a refused module was created');
      return '7 invalid definitions refused';
    });

    await u.step('CUS-03', 'Add field "Badge number" (optional) and make it required; definition keeps its other fields', async () => {
      ok(S.key, 'depends on CUS-01');
      const m = await mine();
      let u1 = await putDef([...keep(m.def.fields), { key: '', label: 'Badge number', type: 'text', required: false }]);
      eq(u1.def.fields.length, 8, 'fields after adding'); const badge = u1.def.fields.find(f => f.label === 'Badge number'); ok(badge && !badge.required, 'Badge starts optional');
      const u2 = await putDef(keep(u1.def.fields).map(f => f.label === 'Badge number' ? { ...f, required: true } : f));
      ok(u2.def.fields.find(f => f.label === 'Badge number').required === true, 'Badge not required'); eq(u2.def.fields.length, 8, 'fields');
      S.badgeKey = badge.key;
      return `Badge (${badge.key}) required`;
    });

    await u.step('CUS-04', 'Record without Badge number is refused naming it; without visitor name refused; with both it is saved with an auto number', async () => {
      ok(S.key, 'depends on CUS-01');
      const def = (await mine()).def;
      const row = { [fk(def, 'Visitor name')]: 'Dr. Majed ' + K, [fk(def, 'Company')]: 'Al-Hayat Clinics', [fk(def, 'Host')]: u.username, [fk(def, 'Visit date')]: '2026-10-14', [fk(def, 'Purpose')]: 'Contract review', [fk(def, 'Phone')]: '0551234567' };
      const bad = refused(await c.post(`/api/custom/records/${S.key}`, { data: row }), 'no badge', [400]);
      ok(/badge number/i.test(bad.text), 'refusal does not name Badge number: ' + bad.text);
      const bad2 = refused(await c.post(`/api/custom/records/${S.key}`, { data: { [fk(def, 'Badge number')]: '118' } }), 'no visitor name', [400]);
      ok(/visitor name/i.test(bad2.text), 'refusal does not name Visitor name: ' + bad2.text);
      const good = must(await c.post(`/api/custom/records/${S.key}`, { data: { ...row, [fk(def, 'Badge number')]: '118' } }), 'save');
      ok(/^VIS-\d{6}$/.test(good.code), 'record number ' + good.code); eq(good.data[fk(def, 'Badge number')], '118', 'badge stored'); eq(good.createdBy, u.username, 'createdBy');
      S.rec = good; S.def = def;
      const all = await records(); ok(all.some(r => r.id === good.id), 'saved record not listed'); ok(all.every(r => r.data[fk(def, 'Badge number')]), 'a record without badge was stored');
      return 'saved ' + good.code;
    });

    await u.step('CUS-05', 'Typed fields: number, e-mail, checkbox added; text in a number field, bad e-mail, option outside the list, wrong date format refused; valid row stored with number 3', async () => {
      ok(S.key && S.def, 'depends on CUS-04');
      const m = await mine();
      const v = await putDef([...keep(m.def.fields), { label: 'Guests', type: 'number', required: false }, { label: 'Contact email', type: 'email', required: false }, { label: 'VIP', type: 'checkbox', required: false }]);
      const def = v.def; S.def = def;
      const base = { [fk(def, 'Visitor name')]: 'Typed ' + K, [fk(def, 'Badge number')]: '200' };
      const post = extra => c.post(`/api/custom/records/${S.key}`, { data: { ...base, ...extra } });
      refused(await post({ [fk(def, 'Guests')]: 'abc' }), 'text in number', [400]);
      refused(await post({ [fk(def, 'Contact email')]: 'not-mail' }), 'bad e-mail', [400]);
      refused(await post({ [fk(def, 'Status')]: 'Gone' }), 'option outside list', [400]);
      refused(await post({ [fk(def, 'Visit date')]: '14/10/2026' }), 'wrong date', [400]);
      const ok1 = must(await post({ [fk(def, 'Guests')]: '3', [fk(def, 'Contact email')]: 'a@b.com', [fk(def, 'Status')]: 'Expected', 'unknown-field': 'dropped', secret: 'x' }), 'valid row');
      eq(ok1.data[fk(def, 'Guests')], 3, 'number stored as number'); eq(ok1.data[fk(def, 'VIP')], false, 'checkbox default'); eq(ok1.data[fk(def, 'Status')], 'Expected', 'status');
      ok(!('secret' in ok1.data) && !('unknown-field' in ok1.data), 'unknown field was stored');
      S.typed = ok1;
      return 'valid row stored; 4 invalid refused';
    });

    await u.step('CUS-06', 'Edit a record: purpose and guests changed; required fields still enforced on edit; unknown id refused', async () => {
      ok(S.rec && S.def, 'depends on CUS-04 / CUS-05');
      const def = S.def, d = { ...S.rec.data, [fk(def, 'Purpose')]: 'Renewal', [fk(def, 'Guests')]: 4 };
      const up = must(await c.put(`/api/custom/records/${S.key}/${S.rec.id}`, { data: d }), 'edit');
      eq(up.data[fk(def, 'Purpose')], 'Renewal', 'purpose'); eq(up.data[fk(def, 'Guests')], 4, 'guests'); eq(up.code, S.rec.code, 'number unchanged');
      const blank = { ...d, [fk(def, 'Badge number')]: '' };
      refused(await c.put(`/api/custom/records/${S.key}/${S.rec.id}`, { data: blank }), 'blank badge on edit', [400]);
      refused(await c.put(`/api/custom/records/${S.key}/nope-${K}`, { data: d }), 'unknown record', [404]);
      eq((await records()).find(r => r.id === S.rec.id).data[fk(def, 'Badge number')], '118', 'badge kept after refused edit');
      S.rec = up;
      return 'edited';
    });

    await u.step('CUS-07', 'Rename the field label "Badge number" -> "Pass number": same key, stored values stay, refusal now names the new label', async () => {
      ok(S.key && S.badgeKey, 'depends on CUS-03');
      const m = await mine();
      const up = await putDef(keep(m.def.fields).map(f => f.key === S.badgeKey ? { ...f, label: 'Pass number' } : f));
      const f = up.def.fields.find(x => x.key === S.badgeKey); ok(f && f.label === 'Pass number', 'label not changed'); S.def = up.def;
      eq((await records()).find(r => r.id === S.rec.id).data[S.badgeKey], '118', 'stored badge value');
      const bad = refused(await c.post(`/api/custom/records/${S.key}`, { data: { [S.def.fields[0].key]: 'Rename ' + K } }), 'save without pass', [400]);
      ok(/pass number/i.test(bad.text) && !/badge number/i.test(bad.text), 'refusal should name Pass number: ' + bad.text);
      return 'label renamed, key ' + S.badgeKey;
    });

    await u.step('CUS-08', 'List and search: both saved visitors listed; search by name finds exactly one; module key itself is not a record list', async () => {
      ok(S.rec && S.typed, 'depends on CUS-04 / CUS-05');
      const all = await records(); ok(all.length >= 2, 'records ' + all.length);
      const q = must(await c.get(`/api/custom/records/${S.key}?q=${encodeURIComponent('Typed ' + K)}`), 'search'); eq(q.length, 1, 'search results'); eq(q[0].id, S.typed.id, 'found record');
      const codes = all.map(r => r.code); eq(new Set(codes).size, codes.length, 'unique record numbers');
      refused(await c.get('/api/custom/records/_def'), 'definition store is not a module', [404]);
      refused(await c.get(`/api/custom/records/nomodule-${K}`), 'unknown module', [404]);
      return `${all.length} records`;
    });

    await u.step('CUS-09', 'Hiding a field (removing it from the definition) keeps the stored phone number; adding it back shows it again', async () => {
      ok(S.rec, 'depends on CUS-04');
      const m = await mine(); const phoneKey = fk(m.def, 'Phone');
      const without = await putDef(keep(m.def.fields).filter(f => f.key !== phoneKey));
      ok(!without.def.fields.some(f => f.key === phoneKey), 'field not removed');
      eq((await records()).find(r => r.id === S.rec.id).data[phoneKey], '0551234567', 'phone kept in the record');
      const edit = must(await c.put(`/api/custom/records/${S.key}/${S.rec.id}`, { data: { ...S.rec.data } }), 'edit while hidden'); eq(edit.data[phoneKey], '0551234567', 'phone kept through an edit');
      const back = await putDef([...keep(without.def.fields), { key: phoneKey, label: 'Phone', type: 'phone', required: false }]); S.def = back.def;
      eq((await records()).find(r => r.id === S.rec.id).data[phoneKey], '0551234567', 'phone back');
      return 'value survived hide and restore';
    });

    await u.step('CUS-10', 'Delete a record: removed from the list, second delete refused; the other record stays', async () => {
      ok(S.typed && S.rec, 'depends on CUS-04 / CUS-05');
      ok((await c.del(`/api/custom/records/${S.key}/${S.typed.id}`)).status === 204, 'delete');
      const l = await records(); ok(!l.some(r => r.id === S.typed.id), 'deleted record listed'); ok(l.some(r => r.id === S.rec.id), 'other record lost');
      refused(await c.del(`/api/custom/records/${S.key}/${S.typed.id}`), 'delete twice', [404]);
      return `${l.length} record left`;
    });

    await u.step('CUS-11', 'Privileges: a colleague with view only can read my records but cannot design, add, edit or delete', async () => {
      ok(S.key && S.rec, 'depends on CUS-04');
      let viewer = null;
      for (let i = 1; i < ws.clients.length && !viewer; i++) {
        const x = ws.clients[i]; if (!x || i === u.n) continue;
        const me = await x.get('/api/users/me'); const eff = (me.ok && (me.data.effectivePermissions || me.data.permissions)) || [];
        if (eff.includes('cus.view') && !eff.includes('cus.manage') && !eff.includes('cus.design')) viewer = x;
      }
      if (!viewer) return 'skipped: no view-only colleague in this workspace';
      ok((await viewer.get(`/api/custom/records/${S.key}`)).ok, 'viewer cannot read');
      refused(await viewer.post('/api/custom/modules', { title: 'Hack ' + K, fields: [{ label: 'A', type: 'text' }] }), 'viewer designs a module', [403]);
      refused(await viewer.put(`/api/custom/modules/${S.key}`, { title: 'Hack', fields: [{ label: 'A', type: 'text' }] }), 'viewer changes my module', [403]);
      refused(await viewer.post(`/api/custom/records/${S.key}`, { data: { [S.def.fields[0].key]: 'x' } }), 'viewer adds a record', [403]);
      refused(await viewer.del(`/api/custom/records/${S.key}/${S.rec.id}`), 'viewer deletes a record', [403]);
      refused(await viewer.del(`/api/custom/modules/${S.key}`), 'viewer deletes my module', [403]);
      return 'read 200, 5 writes refused with 403';
    });

    await u.step('CUS-12', 'Delete a module: its records go too; the module leaves the menu and its record list answers 404', async () => {
      const t = must(await c.post('/api/custom/modules', { title: `Temp-${K}`, fields: [{ label: 'Note', type: 'text', required: true }] }), 'temp module');
      const dup = must(await c.post('/api/custom/modules', { title: `Temp-${K}`, fields: [{ label: 'Note', type: 'text' }] }), 'same title again');
      ok(dup.key !== t.key, 'two modules share the key ' + t.key);
      const r = must(await c.post(`/api/custom/records/${t.key}`, { data: { note: 'x' } }), 'record in temp module'); ok(r.code, 'record number');
      ok((await c.del(`/api/custom/modules/${t.key}`)).status === 204, 'delete module'); ok((await c.del(`/api/custom/modules/${dup.key}`)).status === 204, 'delete second module');
      ok(!(await modules()).some(m => m.key === t.key || m.key === dup.key), 'module still in the menu');
      refused(await c.get(`/api/custom/records/${t.key}`), 'records of deleted module', [404]);
      refused(await c.del(`/api/custom/modules/${t.key}`), 'delete twice', [404]);
      ok((await modules()).some(m => m.key === S.key), 'my main module was lost');
      return 'temp module and its record removed';
    });
  },
};
