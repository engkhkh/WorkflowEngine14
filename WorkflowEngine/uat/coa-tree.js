#!/usr/bin/env node
// Demo chart-of-accounts branches that go 9 levels deep (Expense: regions > cities > offices > departments; Assets: building > floors).
// Parents are stored in each account's "parent" field, so the portal's Tree view / Level selector shows the nesting.
//   run now:   node coa-tree.js [--user=admin] [--password=admin123]        (set $env:API="http://localhost:PORT" to force an address)
//   also used by the seeder (extras.js, step X-COA).
const H = true, L = false;
// [code, parent code, English, Arabic, type, isHeader]
const ROWS = [
  // ---- Expense branch: 6000 (level 1) -> 9 levels
  ['6700', '6000', 'Regional operating expenses', 'المصروفات التشغيلية الإقليمية', 'Expense', H],                         // 2
  ['6710', '6700', 'Saudi Arabia', 'المملكة العربية السعودية', 'Expense', H],                                              // 3
  ['6711', '6710', 'Central Region', 'المنطقة الوسطى', 'Expense', H],                                                      // 4
  ['6711-1', '6711', 'Riyadh', 'الرياض', 'Expense', H],                                                                    // 5
  ['6711-1-1', '6711-1', 'Riyadh Head Office', 'المقر الرئيسي بالرياض', 'Expense', H],                                    // 6
  ['6711-1-1-1', '6711-1-1', 'Head Office Departments', 'إدارات المقر الرئيسي', 'Expense', H],                            // 7
  ['6711-1-1-1-1', '6711-1-1-1', 'Finance Department', 'إدارة المالية', 'Expense', H],                                    // 8
  ['6711-1-1-1-1-1', '6711-1-1-1-1', 'Finance - travel & training', 'المالية - السفر والتدريب', 'Expense', L],            // 9
  ['6711-1-1-1-1-2', '6711-1-1-1-1', 'Finance - software subscriptions', 'المالية - اشتراكات البرامج', 'Expense', L],      // 9
  ['6711-1-1-1-2', '6711-1-1-1', 'HR Department', 'إدارة الموارد البشرية', 'Expense', H],                                  // 8
  ['6711-1-1-1-2-1', '6711-1-1-1-2', 'HR - recruitment costs', 'الموارد البشرية - تكاليف التوظيف', 'Expense', L],         // 9
  ['6711-1-1-1-2-2', '6711-1-1-1-2', 'HR - staff training', 'الموارد البشرية - تدريب الموظفين', 'Expense', L],            // 9
  ['6711-2', '6711', 'Qassim', 'القصيم', 'Expense', H],                                                                    // 5
  ['6711-2-1', '6711-2', 'Qassim branch rent', 'إيجار فرع القصيم', 'Expense', L],                                          // 6
  ['6712', '6710', 'Western Region', 'المنطقة الغربية', 'Expense', H],                                                    // 4
  ['6712-1', '6712', 'Jeddah', 'جدة', 'Expense', H],                                                                       // 5
  ['6712-1-1', '6712-1', 'Jeddah Office', 'مكتب جدة', 'Expense', H],                                                       // 6
  ['6712-1-1-1', '6712-1-1', 'Jeddah utilities', 'مرافق مكتب جدة', 'Expense', L],                                          // 7
  ['6720', '6700', 'United Arab Emirates', 'الإمارات العربية المتحدة', 'Expense', H],                                     // 3
  ['6721', '6720', 'Dubai office running costs', 'تكاليف تشغيل مكتب دبي', 'Expense', L],                                  // 4
  // ---- Assets branch: 1000 (level 1) -> 9 levels
  ['1700', '1000', 'Property, plant & equipment', 'الممتلكات والمنشآت والمعدات', 'Asset', H],                              // 2
  ['1710', '1700', 'Buildings', 'المباني', 'Asset', H],                                                                    // 3
  ['1711', '1710', 'Head office building', 'مبنى المقر الرئيسي', 'Asset', H],                                              // 4
  ['1711-1', '1711', 'Building cost', 'تكلفة المبنى', 'Asset', H],                                                         // 5
  ['1711-1-1', '1711-1', 'Structure and interiors', 'الهيكل والتجهيزات الداخلية', 'Asset', H],                            // 6
  ['1711-1-1-1', '1711-1-1', 'Floors', 'الطوابق', 'Asset', H],                                                             // 7
  ['1711-1-1-1-1', '1711-1-1-1', 'Floor 1', 'الطابق الأول', 'Asset', H],                                                   // 8
  ['1711-1-1-1-1-1', '1711-1-1-1-1', 'Floor 1 - fit-out', 'الطابق الأول - التجهيز', 'Asset', L],                          // 9
  ['1711-1-1-1-1-2', '1711-1-1-1-1', 'Floor 1 - furniture', 'الطابق الأول - الأثاث', 'Asset', L],                         // 9
  ['1711-1-1-1-2', '1711-1-1-1', 'Floor 2', 'الطابق الثاني', 'Asset', H],                                                  // 8
  ['1711-1-1-1-2-1', '1711-1-1-1-2', 'Floor 2 - fit-out', 'الطابق الثاني - التجهيز', 'Asset', L],                         // 9
  ['1720', '1700', 'Vehicles', 'المركبات', 'Asset', L],                                                                    // 3
];

/** Creates the missing accounts through an API client `c`. Returns { created, existing }. */
async function build(c) {
  const have = new Map(((await c.get('/api/finance/records/account')).data || []).map(a => [a.code, a]));
  let created = 0, existing = 0;
  for (const [code, parent, name, nameAr, type, isHeader] of ROWS) {
    if (have.has(code)) { existing++; continue; }
    const r = await c.post('/api/finance/records/account', { code, status: 'Active', data: { name, nameAr, type, isHeader, parent: have.has(parent) || ROWS.some(x => x[0] === parent) ? parent : '' } });
    if (!r.ok && r.status !== 409) throw new Error(`account ${code}: HTTP ${r.status} ${String(r.text).slice(0, 160)}`);
    if (r.ok) { created++; have.set(code, r.data); } else existing++;
  }
  return { created, existing };
}
module.exports = { ROWS, build };

if (require.main === module) {
  const cands = process.env.API ? [process.env.API] : ['http://127.0.0.1:63353', 'http://127.0.0.1:5000', 'http://localhost:63353', 'http://localhost:5000', 'http://127.0.0.1:5055'];
  const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
  (async () => {
    for (const b of cands) { try { await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) }); process.env.API = b; break; } catch { /* next */ } }
    if (!process.env.API) { console.error('No backend found. Start it first, or set $env:API="http://localhost:PORT".'); process.exit(1); }
    const { Client } = require('./lib');
    const c = new Client(arg('user', 'admin')); await c.login(arg('user', 'admin'), arg('password', process.env.UAT_ADMIN_PASSWORD || 'admin123'));
    const r = await build(c);
    console.log(`Chart of accounts: ${r.created} accounts created, ${r.existing} already there (deepest branch: 9 levels). Open Finance > General ledger > Chart of accounts > Tree.`);
  })().catch(e => { console.error(e.message || e); process.exit(1); });
}
