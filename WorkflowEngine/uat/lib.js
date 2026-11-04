// Shared helpers for the UAT runner. Node 18+ (global fetch). No dependencies.
const BASE = (process.env.API || 'http://localhost:63353').replace(/\/$/, '');
const TZ = process.env.TZ_OFFSET || '180';           // Riyadh = UTC+3
const results = [];

class Client {
  constructor(name) { this.name = name; this.token = null; this.info = null; }
  async call(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Tz-Offset': TZ };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let res, text = '', data = null;
    try {
      res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.UAT_TIMEOUT_MS || 90000)) });
      text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    } catch (e) { return { ok: false, status: 0, data: null, text: String(e.message || e), path }; }
    return { ok: res.ok, status: res.status, data, text, path };
  }
  get(p) { return this.call('GET', p); }
  post(p, b) { return this.call('POST', p, b === undefined ? {} : b); }
  put(p, b) { return this.call('PUT', p, b); }
  del(p) { return this.call('DELETE', p); }
  async login(username, password) {
    const r = await this.post('/api/auth/login', { username, password });
    if (!r.ok) throw new Error(`login ${username} failed: ${r.status} ${r.text}`);
    this.token = r.data.token; this.info = r.data; return r.data;
  }
}

/** A failed API reply becomes a readable error message that includes the server's own words. */
function must(r, what) {
  if (r.ok) return r.data;
  const msg = typeof r.data === 'string' ? r.data : (r.data && (r.data.message || r.data.title)) || r.text;
  throw new Error(`${what || r.path}: HTTP ${r.status} ${String(msg).slice(0, 300)}`);
}
/** Expect a refusal (403/401/400/409...) - used by the negative checks. */
function refused(r, what, codes = [400, 401, 403, 404, 409, 422]) {
  if (!codes.includes(r.status)) throw new Error(`${what || r.path}: expected a refusal, got HTTP ${r.status} ${String(r.text).slice(0, 200)}`);
  return r;
}
function eq(actual, expected, label, tol = 0.005) {
  const a = Number(actual), e = Number(expected);
  const same = Number.isFinite(a) && Number.isFinite(e) ? Math.abs(a - e) <= tol : String(actual) === String(expected);
  if (!same) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Run one scenario step. Never throws: the result (Pass / Fail with the reason) goes into the report and the run continues. */
async function step(id, title, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, title, status: 'PASS', note: note || '', ms: Date.now() - t0 }); console.log(`  PASS ${id}  ${title}`); }
  catch (e) { results.push({ id, title, status: 'FAIL', note: String(e.message || e), ms: Date.now() - t0 }); console.log(`  FAIL ${id}  ${title}\n       -> ${e.message || e}`); }
}
/** For steps that cannot be automated through the API (browser-only checks): listed so nothing is silently skipped. */
function manual(id, title, why) { results.push({ id, title, status: 'MANUAL', note: why || '', ms: 0 }); console.log(`  MANUAL ${id}  ${title}`); }

const ymd = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

module.exports = { BASE, Client, must, refused, eq, ok, round2, step, manual, results, ymd, addDays };
