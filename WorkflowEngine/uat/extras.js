// Final phase of the demo seeder: data for the modules whose normal test job cleans up after itself or does not exist.
// Workflow designer + instances + approval inbox, document templates (requests), BPM, Integration, BI, Governance.
// Runs LAST: Governance approval rules are created at the very end so they cannot block the other seed jobs.
const { must, ok } = require('./lib');
const pick = (a, i) => a[i % a.length];

module.exports = {
  id: 'extras', title: 'Workflow, BPM, Integration, BI, Governance demo data', modules: ['workflow', 'bpm', 'int', 'bi', 'gov'],
  async run(u) {
    const c = u.c, CO = u.ws.company, ME = u.username;
    const safe = async (what, fn) => { try { return await fn(); } catch (e) { u.state.fail = (u.state.fail || 0) + 1; require('./load/core').record({ ws: 1, n: 0, profile: 'extras', id: 'X', title: what, status: 'FAIL', note: String(e.message || e).slice(0, 300), ms: 0 }); } };

    // ---- Workflow designer: several published flows, many instances (running, approved, rejected, cancelled)
    await u.step('X-WF', 'Workflow flows and instances', async () => {
      const mkFlow = (name, limit) => { const n = x => `${name.replace(/\W+/g, '').slice(0, 10)}-${x}`; return { name, description: name + ' approval flow (demo)', nodes: [
        { id: n('s'), type: 'Start', name: 'Start', x: 50, y: 100 }, { id: n('l'), type: 'Logger', name: 'Log', x: 200, y: 100, logMessage: 'Request {{amount}}' },
        { id: n('c'), type: 'Condition', name: 'Needs approval?', x: 350, y: 100, conditionExpression: `amount > ${limit}` },
        { id: n('a'), type: 'ApprovalTask', name: 'Manager approval', x: 500, y: 50, assignee: ME, description: 'Please review: ' + name, form: { title: 'Decision', fields: [{ key: 'note', label: 'Note', type: 'Text' }] } },
        { id: n('e1'), type: 'End', name: 'Approved', x: 700, y: 100 }, { id: n('e2'), type: 'End', name: 'Rejected', x: 700, y: 200 }],
        edges: [{ id: n('1'), sourceNodeId: n('s'), targetNodeId: n('l'), label: 'Default' }, { id: n('2'), sourceNodeId: n('l'), targetNodeId: n('c'), label: 'Default' }, { id: n('3'), sourceNodeId: n('c'), targetNodeId: n('a'), label: 'True' },
          { id: n('4'), sourceNodeId: n('c'), targetNodeId: n('e1'), label: 'False' }, { id: n('5'), sourceNodeId: n('a'), targetNodeId: n('e1'), label: 'Approve' }, { id: n('6'), sourceNodeId: n('a'), targetNodeId: n('e2'), label: 'Reject' }] }; };
      const flows = [['Purchase approval', 5000], ['Leave approval', 0], ['Expense approval', 1000], ['Contract review', 20000], ['Capex request', 50000]];
      let made = 0;
      for (const [name, limit] of flows) {
        const d = must(await c.post('/api/definitions', mkFlow(name, limit)), 'create ' + name); must(await c.post(`/api/definitions/${d.id}/publish`, {}), 'publish ' + name);
        for (let i = 0; i < 12; i++) {
          const amount = 200 + ((i * 7919) % 90000);
          const inst = must(await c.post('/api/instances/start', { definitionId: d.id, initialData: { amount, requester: ME, reference: `${name.slice(0, 3).toUpperCase()}-${1000 + i}` } }), 'start'); made++;
          if (inst.status !== 'Running') continue;
          const t = (must(await c.get('/api/tasks'), 'tasks')).find(x => x.instanceId === inst.id); if (!t) continue;
          if (i % 4 === 0) await c.post(`/api/instances/${inst.id}/cancel`, {});
          else if (i % 4 === 1) must(await c.post(`/api/tasks/${t.id}/complete`, { decision: 'Approve', comment: 'Approved', formData: { note: 'ok' } }), 'approve');
          else if (i % 4 === 2) must(await c.post(`/api/tasks/${t.id}/complete`, { decision: 'Reject', comment: 'Over budget' }), 'reject');
          // i % 4 === 3 stays pending: it appears in My approvals
        }
      }
      return `${flows.length} flows, ${made} instances`;
    });

    // ---- Document templates (Requests / Documents / Approvals screens): start instances of every published template
    await u.step('X-DOC', 'Instances of the published document templates', async () => {
      const defs = must(await c.get('/api/definitions'), 'definitions').filter(x => x.isPublished && !/approval flow \(demo\)/.test(x.description || ''));
      let n = 0;
      for (const d of defs.slice(0, 20)) for (let i = 0; i < 4; i++) {
        const r = await c.post('/api/instances/start', { definitionId: d.id, initialData: { amount: 1500 + i * 4300, requester: ME, docNumber: `DOC-${100 + n}`, party: pick(['Al Noor Trading', 'Gulf Supplies', 'Riyadh Tech', 'Nile Foods'], i), currency: 'SAR', branch: pick(Object.values(u.ws.branch), i), description: 'Demo request ' + (n + 1) } });
        if (r.ok) n++;
      }
      return `${n} template instances on ${defs.length} templates`;
    });

    // ---- BPM: processes with SLAs and settings
    await u.step('X-BPM', 'BPM processes', async () => {
      const names = ['Order to cash', 'Procure to pay', 'Hire to retire', 'Record to report', 'Plan to produce', 'Lead to deal', 'Request to fulfil', 'Incident to resolution', 'Idea to launch', 'Budget to forecast'];
      let n = 0; for (let i = 0; i < names.length; i++) { const r = await c.post('/api/erp/bpm/records/process', { company: CO, status: i % 5 === 4 ? 'Inactive' : 'Active', data: { name: names[i], owner: ME, slaHours: 8 * (1 + i % 5), steps: 3 + (i % 5), description: names[i] + ' end-to-end process' } }); if (r.ok) n++; }
      await c.post('/api/erp/bpm/records/setting', { code: 'escalation', company: CO, data: { escalate: true, afterHours: 24 } });
      return n + ' processes';
    });

    // ---- Integration: keys (secrets are not kept), webhooks, connectors, delivery logs
    await u.step('X-INT', 'Integration keys, webhooks, connectors', async () => {
      let n = 0;
      for (const [name, scopes] of [['ERP data reader', ['crm:lead', 'epm:plan']], ['BI export', ['mfg:workorder', 'proc:po']], ['Partner portal', undefined]]) { const r = await c.post('/api/erp/int/apikeys', scopes ? { name, scopes } : { name }); if (r.ok) n++; }
      const hooks = [];
      for (const [name, ev] of [['Accounting sync', 'invoice.posted'], ['Slack notifier', 'approval.pending'], ['Warehouse feed', 'stock.moved']]) { const r = await c.post('/api/erp/int/records/webhook', { company: CO, data: { name, url: 'http://127.0.0.1:9/hook', events: ev, secret: 's3cret' } }); if (r.ok) { hooks.push(r.data); n++; } }
      for (const h of hooks.slice(0, 2)) await c.post(`/api/erp/int/webhooks/${h.id}/test`, {});      // leaves a failed delivery in the log
      for (const [name, type, ep] of [['Bank feed', 'REST', 'https://bank.example.com/api'], ['E-invoicing (ZATCA)', 'REST', 'https://zatca.example.com/api'], ['Payroll WPS', 'SFTP', 'sftp://wps.example.com'], ['Shipping carrier', 'REST', 'https://carrier.example.com/v2']]) { const r = await c.post('/api/erp/int/records/connector', { company: CO, data: { name, type, endpoint: ep } }); if (r.ok) n++; }
      return n + ' integration records';
    });

    // ---- BI: saved reports
    await u.step('X-BI', 'BI saved reports', async () => {
      let n = 0; const rows = [['finance', 'revenueYtd', 'bar'], ['finance', 'expenseYtd', 'line'], ['crm', 'pipeline', 'bar'], ['mfg', 'passRate', 'line'], ['proc', 'openPo', 'bar'], ['wh', 'stockValue', 'bar'], ['pay', 'payrollCost', 'line'], ['prj', 'openTasks', 'pie']];
      for (const [module, metric, chart] of rows) { const r = await c.post('/api/erp/bi/records/report', { company: CO, data: { name: `${module.toUpperCase()} - ${metric}`, module, metric, chart } }); if (r.ok) n++; }
      return n + ' reports';
    });


    // ---- Warehouse: batch / serial tracking rules and lots (expired, near expiry and fresh), on the first products
    await u.step('X-LOT', 'Warehouse tracking rules and lots', async () => {
      const prods = must(await c.get('/api/pos/records/product'), 'products').filter(p => p.code).slice(0, 8);
      ok(prods.length, 'no products yet');
      const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      const br = Object.values(u.ws.branch); let n = 0;
      for (let i = 0; i < prods.length; i++) {
        const p = prods[i]; const serial = i % 4 === 3;
        const tr = await c.post('/api/erp/wh/records/trackrule', { company: CO, status: 'Active', data: { sku: p.code, tracking: serial ? 'serial' : 'batch', shelfLifeDays: serial ? 0 : 365, minExpiryDays: 30, requireExpiry: !serial } });
        if (tr.ok) n++;
        for (let b = 0; b < 3; b++) {
          const qty = serial ? 3 : 20 + b * 15; const expiry = serial ? undefined : day([-40, 25, 300][b]);
          const r = await c.post('/api/erp/wh/records/lot', { company: CO, branch: pick(br, i + b), status: 'Active', data: { sku: p.code, batchNo: `LOT-${p.code}-${2024 + b}${String(i + 1).padStart(2, '0')}`, qty, received: qty, expiry, mfgDate: day(-400 + b * 120), supplier: pick(['Gulf Supplies', 'Al Noor Trading', 'Nile Foods'], b), serials: serial ? [1, 2, 3].map(k => `SN-${p.code}-${b}${k}`) : undefined } });
          if (r.ok) n++;
        }
      }
      return n + ' tracking rules and lots';
    });

    // ---- ZATCA e-invoicing: seller profile, then e-invoices for issued receivables
    await u.step('X-ZATCA', 'ZATCA seller profile and e-invoices', async () => {
      must(await c.put('/api/finance/zatca/profile', { sellerName: 'Demo Trading Company', sellerNameAr: 'شركة العرض التجارية', vatNo: '300123456700003', crNo: '1010123456', street: 'King Fahd Road', building: '1234', district: 'Al Olaya', city: 'Riyadh', postalCode: '12211', country: 'SA' }), 'profile');
      const inv = must(await c.get('/api/finance/records/arinvoice'), 'invoices').filter(x => x.status && !['Draft', 'Cancelled', 'Rejected'].includes(x.status) && !(x.data && x.data.zatca));
      let n = 0; for (const x of inv.slice(0, 25)) { const r = await c.post(`/api/finance/zatca/issue/${x.id}`, {}); if (r.ok) n++; }
      return n + ' e-invoices of ' + inv.length + ' issued invoices';
    });


    // ---- HR reference data that the normal job does not create (job titles, cost centres, legal entities)
    await u.step('X-HR', 'HR job titles, cost centres, entities', async () => {
      let n = 0;
      for (const [kind, rows] of [['job', ['Accountant', 'Sales Executive', 'Warehouse Keeper', 'Production Supervisor', 'HR Officer', 'Software Engineer', 'Project Manager', 'Doctor', 'Nurse']],
        ['costcenter', ['Head Office', 'Sales', 'Operations', 'IT', 'Finance']], ['entity', ['Demo Trading Co.', 'Demo Industries']]]) {
        for (let i = 0; i < rows.length; i++) { const r = await c.post(`/api/hr/records/${kind}`, { id: 'new', kind, code: `${kind.toUpperCase().slice(0, 3)}-${i + 1}`, data: { name: rows[i], nameAr: rows[i] } }); if (r.ok) n++; }
      }
      return n + ' reference records';
    });

    // ---- Chart of accounts: two branches that go 9 levels deep (shown by the Tree view / Level selector)
    await u.step('X-COA', 'Chart of accounts - 9-level tree', async () => { const r = await require('./coa-tree').build(c); return `${r.created} accounts created, ${r.existing} existing`; });

    // ---- Governance last: custom fields, delegation (needs a 2nd user), approval rules above a high amount (they never block demo data)
    await u.step('X-GOV', 'Governance fields and approval rules', async () => {
      let n = 0;
      for (const [target, key, labelEn, type, options] of [['crm/lead', 'region', 'Region', 'select', 'Central,Western,Eastern,Northern'], ['crm/lead', 'budgetConfirmed', 'Budget confirmed', 'bool', ''], ['mfg/workorder', 'customerRef', 'Customer reference', 'text', ''], ['epm/plan', 'scenario', 'Scenario', 'select', 'Base,Optimistic,Conservative']]) {
        const r = await c.post('/api/erp/gov/records/customfield', { company: CO, status: 'Active', data: { target, key, labelEn, labelAr: labelEn, type, options, order: n + 1 } }); if (r.ok) n++; }
      const other = u.ws.clients[1] && u.ws.clients[1].name;           // delegations need a second active user
      if (other) { const t = new Date(); const f = x => new Date(t.getTime() + x * 864e5).toISOString().slice(0, 10);
        for (const [a, b] of [[-30, -20], [-1, 14], [30, 40]]) { const r = await c.post('/api/erp/gov/records/delegation', { company: CO, status: 'Active', data: { to: other, fromDate: f(a), toDate: f(b), note: 'Demo delegation' } }); if (r.ok) n++; } }
      for (const [target, name, min] of [['proc/po', 'Large purchase orders', 500000], ['pay/run', 'Payroll runs', 2000000], ['finance/journal', 'Large manual journals', 1000000]]) {
        const r = await c.post('/api/erp/gov/records/rule', { company: CO, status: 'Active', data: { target, name, minAmount: min, maxAmount: 0, steps: [{ label: 'Finance director', privilege: 'gov.approvals.admin' }], escalateAfterHours: 24 } }); if (r.ok) n++; }
      return n + ' governance records';
    });
  }
};
