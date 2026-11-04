// Shared helpers for the finance user types (not a profile: the runner only loads files named pNN-*.js).
const { must, eq, ok } = require('../lib');
const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const eom = ymd => { const [y, m] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const ACC = { cash: '1010', bank: '1020', ar: '1100', vatIn: '1150', inv: '1200', fa: '1500', accDep: '1590', ap: '2100', vatOut: '2150', accrued: '2200', cap: '3100', sales: '4100', service: '4200', rent: '6200', office: '6500', dep: '6600' };
const invTotal = d => (toNum(d && d.total) > 0 ? toNum(d.total) : toNum(d && d.amount) + toNum(d && d.taxAmount));

const flist = async (c, kind, q = '') => must(await c.get(`/api/finance/records/${kind}${q}`), `list ${kind}`);
const fcreate = async (c, kind, body) => must(await c.post(`/api/finance/records/${kind}`, body), `create ${kind}`);
/** PUT replaces the whole data object: send the record's own data merged with the change. */
const fput = (c, kind, rec, patch = {}) => c.put(`/api/finance/records/${kind}/${rec.id}`, { status: patch.status || rec.status, data: Object.assign({}, rec.data, patch.data || {}) });
const fputOk = async (c, kind, rec, patch, what) => must(await fput(c, kind, rec, patch), what || `update ${kind} ${rec.code}`);
const byId = async (c, kind, id) => { const r = (await flist(c, kind)).find(x => x.id === id); ok(r, `${kind} ${id} not found`); return r; };

/** Create a journal (status Posted straight away needs finance.gl.approve, which the finance role has). */
async function journal(c, company, { date, memo, reference, lines, status = 'Posted', currency = 'SAR', rate = 1 }) {
  return fcreate(c, 'journal', { company, status, data: { date, memo, reference, currency, rate, lines: lines.map(l => ({ account: l.account, debit: r2(l.debit || 0), credit: r2(l.credit || 0), costCenter: l.costCenter || '', project: '', memo: l.memo || '', icPartner: '' })) } });
}
/** Net debit - credit per account over the given journals (base currency). */
function net(journals) {
  const by = {}; let dr = 0, cr = 0;
  for (const j of journals) {
    const rate = toNum(j.data.rate) > 0 ? toNum(j.data.rate) : 1;
    for (const l of (j.data.lines || [])) {
      const a = by[l.account] || (by[l.account] = { d: 0, c: 0 });
      const d = toNum(l.debit) * rate, k = toNum(l.credit) * rate; a.d += d; a.c += k; dr += d; cr += k;
    }
  }
  return { by, dr: r2(dr), cr: r2(cr), of: code => r2(((by[code] || {}).d || 0) - ((by[code] || {}).c || 0)) };
}
/** Same bucket rule as FinanceController.Aging. */
function ageBucket(due, today) {
  const late = Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
  return late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
}
/** Make sure a bank account exists for this user. */
async function bankAccount(c, company, code, name, opening = 0) {
  const ex = (await flist(c, 'bankaccount')).find(b => b.code === code);
  if (ex) return ex;
  return fcreate(c, 'bankaccount', { code, company, status: 'Active', data: { name, bankName: 'Bank ' + code, currency: 'SAR', glAccount: ACC.bank, openingBalance: opening } });
}
const bankBalance = async (c, bank) => { const txns = (await flist(c, 'banktxn')).filter(t => t.data.account === bank.code); return r2(toNum(bank.data.openingBalance) + txns.reduce((s, t) => s + toNum(t.data.amount), 0)); };

module.exports = { must, eq, ok, toNum, r2, addDays, eom, ACC, invTotal, flist, fcreate, fput, fputOk, byId, journal, net, ageBucket, bankAccount, bankBalance };
