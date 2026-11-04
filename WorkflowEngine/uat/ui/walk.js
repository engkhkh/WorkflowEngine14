#!/usr/bin/env node
/**
 * Real-browser walk of every screen and button, one signed-in browser per user (portal and/or mobile).
 *
 *   cd uat/ui && npm i && npx playwright install chromium         (once)
 *   $env:API="http://127.0.0.1:5000"                               (PowerShell; backend)
 *   node walk.js --app=portal --base=http://localhost:4200 --ws=10 --parallel=15
 *   node walk.js --app=mobile --base=http://localhost:8100 --ws=10 --parallel=15
 *
 * What it does, per user (each user = one account of the 21 user types, the same accounts as ../load100.js):
 *   1. creates the workspaces / users / shared master data through the API (same code as the API load test),
 *   2. signs in through the real login screen,
 *   3. finds every screen the user may open (side menu, More page, sub tabs inside each module),
 *   4. on every screen: presses every New/Add button, fills the form with realistic values (by field type and label),
 *      adds table lines, presses Save; opens the first rows, edits and saves; presses every row action
 *      (approve, post, receive, ...) and confirms it; walks the tabs; never presses Delete/Destroy/Remove,
 *   5. records what happened per screen: saved, refused by the screen (message), HTTP 4xx/5xx, console errors.
 * Result: ui-report-<app>.md and .json.
 * Options: --ws=N workspaces (21 users each; 10 = 210 users)  --users=N cap the number of users  --parallel=N browsers at once
 *          --headed  --maxScreens=N per user (default 60)  --role=<profile id> only that user type  --slow=ms
 */
const fs = require('fs');
const path = require('path');
const core = require('../load/core');
const { chromium } = require('playwright');

const argv = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const APP = argv.app || 'portal';
const BASE = (argv.base || (APP === 'mobile' ? 'http://localhost:8100' : 'http://localhost:4200')).replace(/\/$/, '');
const WS = Number(argv.ws || 1);
const PARALLEL = Number(argv.parallel || 8);
const MAXSCREENS = Number(argv.maxScreens || 60);
const SLOW = Number(argv.slow || 0);
const SCREEN_LIMIT = Number(argv.screenLimit || 90) * 1000;
const VIEW = APP === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };

const profiles = fs.readdirSync(path.join(__dirname, '..', 'load')).filter(f => /^p\d+.*\.js$/.test(f)).sort().map(f => Object.assign({ file: f }, require('../load/' + f)));
const PER = profiles.length;

// ------------------------------------------------------------------ data generators
let seq = 0;
const FIRST = ['Omar', 'Layla', 'Khalid', 'Sara', 'Yousef', 'Noura', 'Faisal', 'Hana', 'Majed', 'Reem'];
const LAST = ['Alharbi', 'Alqahtani', 'Alotaibi', 'Alghamdi', 'Alzahrani', 'Almutairi'];
const CITIES = ['Riyadh', 'Jeddah', 'Dammam', 'Makkah', 'Madinah'];
const pick = (a, n) => a[Math.abs(n) % a.length];
const iso = (days = 0) => { const d = new Date(Date.now() + days * 864e5); return d.toISOString().slice(0, 10); };

function valueFor(meta, u, n) {
  const hint = `${meta.name} ${meta.label} ${meta.placeholder}`.toLowerCase();
  const tag = u.tag + String(n).padStart(3, '0');
  switch (meta.type) {
    case 'number': {
      let v = /year/.test(hint) ? 2026 : /percent|%|rate|discount|vat|tax/.test(hint) ? 10 : /qty|quantity|count|days|hours|years|months|units/.test(hint) ? 3 : /price|cost|amount|salary|total|budget|value|fee|limit|balance/.test(hint) ? 500 + (n % 7) * 100 : 5 + (n % 9);
      if (meta.min !== '' && Number(meta.min) > v) v = Number(meta.min);
      if (meta.max !== '' && Number(meta.max) < v) v = Number(meta.max);
      return String(v);
    }
    case 'date': return /birth/.test(hint) ? '1990-05-12' : /end|due|expiry|expire|valid|until|to\b/.test(hint) ? iso(30) : /hire|start|from|date|issue|received/.test(hint) ? iso(0) : iso(0);
    case 'datetime-local': return iso(1) + 'T10:00';
    case 'time': return '10:00';
    case 'month': return iso(0).slice(0, 7);
    case 'email': return `qa.${tag}@example.com`.toLowerCase();
    case 'tel': return '05' + String(10000000 + (seq * 7919 + n * 31) % 89999999);
    case 'url': return `https://example.com/${tag}`;
    case 'password': return core.PASSWORD;
    case 'color': return '#0f766e';
    default: break;
  }
  if (/e-?mail/.test(hint)) return `qa.${tag}@example.com`.toLowerCase();
  if (/phone|mobile|tel\b|whatsapp|جوال|هاتف/.test(hint)) return '05' + String(10000000 + (seq * 7919 + n * 31) % 89999999);
  if (/national.?id|iqama|identity/.test(hint)) return '1' + String(100000000 + (seq * 104729) % 899999999);
  if (/tax.?no|vat.?no|cr\b|registration/.test(hint)) return '3' + String(10000000000000 + (seq * 15485863) % 89999999999999);
  if (/\bcode\b|\bno\b|number|sku|barcode|reference|ref\b|badge|plate|serial/.test(hint)) return `Q${u.key}-${n}`;
  if (/year/.test(hint)) return '2026';
  if (/city|location|address|site|branch/.test(hint)) return pick(CITIES, n) + ' ' + tag;
  if (/first.?name/.test(hint)) return pick(FIRST, n);
  if (/last.?name|family/.test(hint)) return pick(LAST, n);
  if (/user.?name|login/.test(hint)) return `qa${u.key.toLowerCase()}${n}`;
  if (/name|title|subject|customer|supplier|vendor|patient|employee|item|product|project|company|department|unit|position|task/.test(hint)) return `${pick(FIRST, n)} ${pick(LAST, n + 1)} ${tag}`;
  if (/note|remark|description|comment|reason|memo|summary|details|body|message|purpose|diagnos|complaint/.test(hint)) return `Automated entry ${tag}: ${pick(['follow up next week', 'approved by management', 'checked and confirmed', 'prepared for review'], n)}`;
  if (/currency/.test(hint)) return 'SAR';
  if (/yes|true|active/.test(hint)) return 'Active';
  return `Test ${tag}`;
}

// ------------------------------------------------------------------ page helpers
const MODAL = '.modal-scrim .modal, ion-modal, .modal-wrapper, .drawer-panel, [role=dialog]';
const NO_TOUCH = /\b(delete|remove|destroy|dispose|purge|erase|reset|sign.?out|log.?out|deactivate|cancel account|حذف|إزالة|إتلاف|تسجيل الخروج)\b/i;
const CANCELISH = /^(cancel|close|back|dismiss|no|إلغاء|إغلاق|رجوع|لا)$/i;

async function visible(loc) { try { return await loc.isVisible(); } catch { return false; } }

async function controlsOf(scope) {
  return scope.evaluate(root => {
    const out = []; const seen = new Set();
    const labelOf = el => {
      if (el.id) { const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.textContent.trim(); }
      let p = el.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) { const l = p.querySelector(':scope > label, :scope > .lbl, :scope > ion-label'); if (l) return l.textContent.trim(); }
      return el.getAttribute('aria-label') || '';
    };
    const els = root.querySelectorAll('input, select, textarea');
    els.forEach((el, i) => {
      if (seen.has(el)) return; seen.add(el);
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) return;
      if (el.disabled || el.readOnly) return;
      const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text');
      if (['hidden', 'file', 'submit', 'button', 'image', 'reset'].includes(type)) return;
      el.setAttribute('data-qa', String(i));
      out.push({ qa: i, type, name: el.getAttribute('name') || '', label: labelOf(el), placeholder: el.getAttribute('placeholder') || '', min: el.getAttribute('min') || '', max: el.getAttribute('max') || '',
        value: el.value, checked: !!el.checked, required: el.required || el.getAttribute('aria-required') === 'true', inTable: !!el.closest('table') });
    });
    return out;
  });
}

async function fillForm(page, scope, u, stats, only = null) {
  const list = await controlsOf(scope);
  let n = 0;
  for (const m of list) {
    if (only && !only(m)) continue;
    const el = scope.locator(`[data-qa="${m.qa}"]`).first();
    try {
      n++; seq++;
      if (m.type === 'select') {
        const opts = await el.evaluate(s => Array.from(s.options).map((o, i) => ({ i, v: o.value, t: o.textContent.trim(), d: o.disabled })));
        const real = opts.filter(o => !o.d && o.v !== '' && o.v !== 'null' && o.v !== 'undefined' && !/^(select|choose|—|-|اختر)/i.test(o.t));
        if (!real.length) continue;
        if (m.value && real.some(o => o.v === m.value) && !only) { if (seq % 3) continue; }
        await el.selectOption({ index: real[seq % real.length].i }, { timeout: 1500 });
      } else if (m.type === 'checkbox') {
        if (!m.checked && seq % 2 === 0) await el.check({ timeout: 1500, force: true });
      } else if (m.type === 'radio') {
        if (!m.checked) await el.check({ timeout: 1500, force: true });
      } else if (m.type === 'range') {
        continue;
      } else {
        if (m.value && !only && !/^(0|0\.00|1)$/.test(m.value)) { if (m.type !== 'date' || m.value) continue; }   // keep defaults the screen already proposes
        await el.fill(valueFor(m, u, n), { timeout: 1500 });
        await el.dispatchEvent('change').catch(() => {});
      }
    } catch (e) { stats.fillErrors++; }
  }
  stats.fields += n;
  return n;
}

async function topModal(page) {
  const all = page.locator(MODAL);
  const n = await all.count();
  for (let i = n - 1; i >= 0; i--) { const m = all.nth(i); if (await visible(m)) return m; }
  return null;
}
async function closeModals(page) {
  for (let k = 0; k < 4; k++) {
    const m = await topModal(page); if (!m) return;
    const btn = m.locator('button, ion-button').filter({ hasText: CANCELISH }).first();
    if (await btn.count()) await btn.click({ timeout: 1500 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function flashText(scope) {
  const f = scope.locator('.flash.bad, .error, .alert-danger, ion-toast, .toast.bad, .field-error').first();
  try { if (await f.count() && await f.isVisible()) return (await f.innerText()).trim().slice(0, 200); } catch {}
  return '';
}

/** Submit the open form: press the primary button of the modal, wait for it to close; one repair attempt on a refusal. */
async function submitModal(page, modal, u, stats, label) {
  const save = modal.locator('.modal-foot button.primary, button.primary:not(.danger-fill), ion-button[type=submit], ion-footer ion-button').last();
  if (!(await save.count())) { stats.noSave++; return 'nosave'; }
  const text = ((await save.innerText().catch(() => '')) || '').trim();
  if (NO_TOUCH.test(text)) { await closeModals(page); return 'skipped'; }
  for (let attempt = 0; attempt < 2; attempt++) {
    await save.click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(350);
    for (let w = 0; w < 14; w++) {
      if (!(await topModal(page))) { stats.saved++; return 'saved'; }
      await page.waitForTimeout(250);
    }
    const msg = await flashText(page);
    if (attempt === 0) {
      // repair: fill every still-empty control, add a line when the form asks for lines
      stats.repairs++;
      const addLine = modal.locator('button.sm:has(app-icon[name=plus]), button:has-text("Add line"), button:has-text("إضافة سطر")').first();
      if (await addLine.count() && /line|item|row|سطر|بند/i.test(msg + ' ')) { await addLine.click({ timeout: 1200 }).catch(() => {}); }
      await fillForm(page, modal, u, stats, m => !m.value || m.type === 'select');
      continue;
    }
    stats.refused.push((label + ': ' + (msg || 'form stayed open')).slice(0, 220));
    await closeModals(page);
    return 'refused';
  }
  await closeModals(page);
  return 'refused';
}

async function addLines(page, modal, u, stats) {
  const add = modal.locator('button:has(app-icon[name=plus]).sm, button.sm:has-text("line"), button.sm:has-text("سطر")');
  const c = await add.count();
  for (let i = 0; i < Math.min(c, 2); i++) {
    for (let k = 0; k < 2; k++) { await add.nth(i).click({ timeout: 1200 }).catch(() => {}); await page.waitForTimeout(120); }
  }
}

// ------------------------------------------------------------------ one screen
async function exerciseScreen(page, u, rec) {
  const stats = rec.stats;
  const main = page.locator('main, .content, ion-content, .page, app-root').first();

  // 1. every New/Add button
  const creators = page.locator('main button.primary, ion-content button.primary, .content button.primary, .page-head button.primary, ion-fab-button, ion-content ion-button[color=primary]')
    .filter({ has: page.locator('app-icon[name=plus], ion-icon[name*=add]') });
  let cn = await creators.count().catch(() => 0);
  if (!cn) {
    const alt = page.locator('main button.primary, ion-content button.primary, .content button.primary').filter({ hasText: /^\s*(\+|new|add|create|register|book|open|start|record|issue|جديد|إضافة|إنشاء|تسجيل|حجز)/i });
    cn = await alt.count().catch(() => 0);
    for (let i = 0; i < Math.min(cn, 3); i++) await oneCreate(page, alt.nth(i), u, stats, rec, 'new#' + i);
  } else {
    for (let i = 0; i < Math.min(cn, 3); i++) await oneCreate(page, creators.nth(i), u, stats, rec, 'new#' + i);
  }

  // 2. first rows: edit + every row action
  const rows = page.locator('table.data tbody tr, ion-list ion-item.row, .rows .row, ion-card.rec');
  const rn = await rows.count().catch(() => 0);
  for (let r = 0; r < Math.min(rn, 2); r++) {
    const row = rows.nth(r);
    const btns = row.locator('button, ion-button');
    const bc = await btns.count().catch(() => 0);
    for (let b = 0; b < Math.min(bc, 8); b++) {
      const btn = row.locator('button, ion-button').nth(b);
      if (!(await visible(btn))) continue;
      const t = ((await btn.innerText().catch(() => '')) + ' ' + (await btn.getAttribute('title').catch(() => '') || '')).trim();
      const cls = (await btn.getAttribute('class').catch(() => '')) || '';
      if (/danger/.test(cls) || NO_TOUCH.test(t)) { stats.skippedDanger++; continue; }
      await pressAndHandle(page, btn, u, stats, rec, 'row' + r + ':' + (t || 'icon').slice(0, 24));
    }
  }

  // 3. tabs / segments (view only)
  const tabs = page.locator('.tabs button, .seg button, ion-segment-button, [role=tab]');
  const tn = await tabs.count().catch(() => 0);
  for (let i = 0; i < Math.min(tn, 8); i++) { await tabs.nth(i).click({ timeout: 1200 }).catch(() => {}); stats.tabs++; await page.waitForTimeout(160); }

  // 4. toolbar buttons that are not create / destructive (approve all, calculate, post ...)
  const bar = page.locator('main .page-head button:not(.primary), main .toolbar button, ion-content .toolbar button').filter({ hasNotText: /print|export|download|import|upload|طباعة|تصدير|استيراد/i });
  const bn = await bar.count().catch(() => 0);
  for (let i = 0; i < Math.min(bn, 4); i++) { const b = bar.nth(i); const t = (await b.innerText().catch(() => '')).trim(); if (NO_TOUCH.test(t) || CANCELISH.test(t)) continue; await pressAndHandle(page, b, u, stats, rec, 'bar:' + t.slice(0, 24)); }
}

async function oneCreate(page, btn, u, stats, rec, label) {
  if (!(await visible(btn))) return;
  stats.clicks++;
  await btn.click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(350 + SLOW);
  const modal = await topModal(page);
  if (!modal) { await page.waitForTimeout(300); return; }
  stats.forms++;
  await addLines(page, modal, u, stats);
  await fillForm(page, modal, u, stats);
  const r = await submitModal(page, modal, u, stats, label);
  if (r === 'saved') rec.created++;
  await page.waitForTimeout(200);
}

/** Press a row/toolbar button; if a form opens, fill and submit it; if a confirm opens, confirm it. */
async function pressAndHandle(page, btn, u, stats, rec, label) {
  stats.clicks++;
  await btn.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300 + SLOW);
  const modal = await topModal(page);
  if (!modal) return;
  const inputs = await controlsOf(modal).catch(() => []);
  if (!inputs.length) {
    // pure confirmation / read-only view: confirm only when it is not a destructive prompt
    const text = ((await modal.innerText().catch(() => '')) || '').slice(0, 300);
    if (NO_TOUCH.test(text)) { await closeModals(page); return; }
    const ok = modal.locator('.modal-foot button.primary, button.primary').last();
    if (await ok.count() && !/danger/.test((await ok.getAttribute('class').catch(() => '')) || '')) { stats.confirms++; const r = await submitModal(page, modal, u, stats, label); if (r === 'saved') rec.actions++; }
    else await closeModals(page);
    return;
  }
  stats.forms++;
  await addLines(page, modal, u, stats);
  await fillForm(page, modal, u, stats, label.startsWith('row') ? (m => true) : null);
  const r = await submitModal(page, modal, u, stats, label);
  if (r === 'saved') rec.actions++;
}

// ------------------------------------------------------------------ sign in + discovery
async function login(page, user) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  if (APP === 'mobile') {
    await page.locator('ion-input input').nth(0).fill(user.username);
    await page.locator('ion-input input[type=password]').first().fill(core.PASSWORD);
    await page.locator('ion-button:has-text("Sign"), ion-button:has-text("دخول"), ion-button').first().click();
  } else {
    await page.locator('input[name=username]').fill(user.username);
    await page.locator('input[name=password]').fill(core.PASSWORD);
    await page.locator('button.go').click();
  }
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 });
  await page.waitForTimeout(900);
  // first-run wizard
  if (/\/setup/.test(page.url())) { await page.goto(BASE + (APP === 'mobile' ? '/tabs/home' : '/dashboard')); await page.waitForTimeout(500); }
}

async function discover(page) {
  const found = new Set();
  const add = h => { if (!h) return; try { const u = new URL(h, BASE); if (u.origin !== BASE) return; const p = u.pathname + u.search; if (/^\/(login|logout|accept-invite|s\/)/.test(p)) return; found.add(p); } catch {} };
  if (APP === 'mobile') {
    for (const h of await page.locator('ion-tab-button[href]').evaluateAll(els => els.map(e => e.getAttribute('href')))) add(h);
    await page.goto(BASE + '/tabs/more', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(700);
    const items = page.locator('ion-item[button]');
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      await page.goto(BASE + '/tabs/more', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(350);
      const it = page.locator('ion-item[button]').nth(i);
      const t = ((await it.innerText().catch(() => '')) || '').trim();
      if (NO_TOUCH.test(t)) continue;
      await it.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(450);
      add(page.url());
    }
  } else {
    for (const h of await page.locator('aside.side nav a[href], nav a[href]').evaluateAll(els => els.map(e => e.getAttribute('href')))) add(h);
  }
  return [...found];
}

async function subLinks(page, visited) {
  const hrefs = await page.locator('main a[href^="/"], .content a[href^="/"], ion-content a[href^="/"], .subnav a[href], .tabs a[href], .erp-nav a[href]').evaluateAll(els => els.map(e => e.getAttribute('href'))).catch(() => []);
  return [...new Set(hrefs.filter(h => h && !visited.has(h) && !/^\/(login|logout)/.test(h)))].slice(0, 20);
}

// ------------------------------------------------------------------ one user
const results = [];   // per user
async function walkUser(browser, job) {
  const { ws, n, p } = job;
  const username = core.uname(ws.i, n);
  const u = { key: `W${ws.i}U${core.pad(n)}`, tag: ws.i * 1000 + n * 10, username, profile: p.id, ws: ws.i, n };
  const res = { user: username, profile: p.id, ws: ws.i, screens: [], error: null, ms: 0 };
  const t0 = Date.now();
  const ctx = await browser.newContext({ viewport: VIEW, baseURL: BASE, acceptDownloads: false, userAgent: APP === 'mobile' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' : undefined, hasTouch: APP === 'mobile', isMobile: APP === 'mobile' });
  if (argv.blockExternal) await ctx.route(url => { try { const h = new URL(url).hostname; return !['localhost','127.0.0.1'].includes(h); } catch { return false; } }, r => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  page.on('dialog', d => d.accept().catch(() => {}));
  let cur = null;
  const note = (kind, text) => { if (cur) cur[kind].push(String(text).split('\n')[0].slice(0, 220)); };
  page.on('pageerror', e => note('jsErrors', e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|fonts\.g|Failed to load resource: the server responded with a status of (40[1349]|404)/i.test(m.text())) note('consoleErrors', m.text()); });
  page.on('response', r => {
    const url = r.url(); if (!/\/api\//.test(url)) return;
    const st = r.status(); if (st < 400) return;
    const entry = `${r.request().method()} ${url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/[0-9a-f]{32}|[0-9a-f-]{36}/g, ':id')} -> ${st}`;
    if (st >= 500) note('http5xx', entry); else if (st !== 403) note('http4xx', entry);
  });
  try {
    await login(page, { username });
    let screens = await discover(page);
    const visited = new Set();
    const queue = [...screens];
    while (queue.length && visited.size < MAXSCREENS) {
      const route = queue.shift(); if (visited.has(route)) continue; visited.add(route);
      const rec = { route, ms: 0, created: 0, actions: 0, stats: { clicks: 0, forms: 0, fields: 0, saved: 0, repairs: 0, noSave: 0, confirms: 0, tabs: 0, fillErrors: 0, skippedDanger: 0, refused: [] }, jsErrors: [], consoleErrors: [], http4xx: [], http5xx: [], loadError: '' };
      cur = rec; const s0 = Date.now();
      try {
        const work = (async () => {
          await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(600 + SLOW);
          const body = ((await page.locator('body').innerText().catch(() => '')) || '').trim();
          if (!body || /something went wrong|cannot match any routes|404/i.test(body.slice(0, 400))) rec.loadError = 'blank or error page: ' + body.slice(0, 80).replace(/\s+/g, ' ');
          await exerciseScreen(page, u, rec);
          for (const l of await subLinks(page, visited)) if (!queue.includes(l)) queue.push(l);
        })();
        work.catch(() => {});
        let timer; const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('screen took longer than ' + SCREEN_LIMIT / 1000 + ' s (server slow or stuck)')), SCREEN_LIMIT); });
        try { await Promise.race([work, limit]); } finally { clearTimeout(timer); }
      } catch (e) { rec.loadError = String(e.message || e).split('\n')[0].slice(0, 200); }
      if (rec.loadError.startsWith('screen took')) await page.goto('about:blank').catch(() => {});
      await closeModals(page).catch(() => {});
      rec.ms = Date.now() - s0; res.screens.push(rec); cur = null;
    }
  } catch (e) { res.error = String(e.message || e).split('\n')[0].slice(0, 240); }
  res.ms = Date.now() - t0;
  await ctx.close().catch(() => {});
  return res;
}

// ------------------------------------------------------------------ report
function report(all, t0) {
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const L = [];
  const ok = all.filter(r => !r.error);
  const scr = all.flatMap(r => r.screens.map(s => ({ ...s, user: r.user, profile: r.profile })));
  const sum = f => scr.reduce((a, s) => a + f(s), 0);
  L.push(`# UI walk (${APP})`, '', `${BASE} · ${all.length} users (${ok.length} signed in and walked, ${all.length - ok.length} failed to sign in) · ${scr.length} screen visits · ${secs} s`, '',
    `**Forms opened ${sum(s => s.stats.forms)} · saved ${sum(s => s.stats.saved)} · refused by the screen ${sum(s => s.stats.refused.length)} · button presses ${sum(s => s.stats.clicks)} · fields filled ${sum(s => s.stats.fields)}**`,
    `Records created ${sum(s => s.created)} · row/toolbar actions completed ${sum(s => s.actions)} · server errors (5xx) ${sum(s => s.http5xx.length)} · other API errors (4xx) ${sum(s => s.http4xx.length)} · JavaScript errors ${sum(s => s.jsErrors.length)} · screens that failed to load ${scr.filter(s => s.loadError).length}`, '');
  if (all.some(r => r.error)) { L.push('## Users that could not sign in / crashed', '', '| User | Type | Problem |', '| --- | --- | --- |'); for (const r of all.filter(x => x.error)) L.push(`| ${r.user} | ${r.profile} | ${r.error} |`); L.push(''); }

  // per screen (route) across users
  const byRoute = {};
  for (const s of scr) { const o = (byRoute[s.route] = byRoute[s.route] || { visits: 0, forms: 0, saved: 0, refused: [], created: 0, actions: 0, http5xx: [], http4xx: [], js: [], load: [], ms: [], users: new Set() }); o.visits++; o.forms += s.stats.forms; o.saved += s.stats.saved; o.created += s.created; o.actions += s.actions; o.refused.push(...s.stats.refused); o.http5xx.push(...s.http5xx); o.http4xx.push(...s.http4xx); o.js.push(...s.jsErrors, ...s.consoleErrors); if (s.loadError) o.load.push(s.loadError); o.ms.push(s.ms); o.users.add(s.profile); }
  const top = (arr, n = 2) => { const m = new Map(); for (const a of arr) m.set(a, (m.get(a) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}${v > 1 ? ' ×' + v : ''}`).join('; '); };
  L.push('## Screens', '', '| Screen | Visits | Forms | Saved | Refused | Actions | 5xx | 4xx | JS errs | Load problems | Typical refusal / error |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [route, o] of Object.entries(byRoute).sort((a, b) => (b[1].http5xx.length + b[1].js.length + b[1].load.length + b[1].refused.length) - (a[1].http5xx.length + a[1].js.length + a[1].load.length + a[1].refused.length))) {
    const typical = top([...o.http5xx, ...o.load, ...o.js, ...o.refused].map(x => x.replace(/\|/g, '/')), 2);
    L.push(`| ${route} | ${o.visits} | ${o.forms} | ${o.saved} | ${o.refused.length} | ${o.actions} | ${o.http5xx.length} | ${o.http4xx.length} | ${o.js.length} | ${o.load.length} | ${typical.slice(0, 300)} |`);
  }
  L.push('');
  const refusals = scr.flatMap(s => s.stats.refused);
  if (refusals.length) { L.push('## Most common refusals by the screens (these are the forms I could not fill correctly or real validation gaps)', ''); for (const [k, v] of [...refusals.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) L.push(`- ×${v} ${k}`); L.push(''); }
  const e5 = scr.flatMap(s => s.http5xx.map(x => `${s.route} :: ${x}`));
  if (e5.length) { L.push('## Server errors (5xx)', ''); for (const [k, v] of [...e5.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) L.push(`- ×${v} ${k}`); L.push(''); }
  const js = scr.flatMap(s => [...s.jsErrors, ...s.consoleErrors].map(x => `${s.route} :: ${x}`));
  if (js.length) { L.push('## JavaScript / console errors', ''); for (const [k, v] of [...js.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) L.push(`- ×${v} ${k}`); L.push(''); }
  const e4 = scr.flatMap(s => s.http4xx.map(x => `${s.route} :: ${x}`));
  if (e4.length) { L.push('## Other API refusals (4xx, not 403)', ''); for (const [k, v] of [...e4.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) L.push(`- ×${v} ${k}`); L.push(''); }
  return L.join('\n');
}

// ------------------------------------------------------------------ main
(async () => {
  const t0 = Date.now();
  const API = process.env.API || 'http://127.0.0.1:5000';
  console.log(`UI walk ${APP}: ${BASE}; API ${API}; ${WS} workspace(s) x ${PER} users; ${PARALLEL} browsers at once`);
  const wss = [];
  for (let i = 1; i <= WS; i++) wss.push(await core.createWorkspace(i));
  await core.pool(wss, WS, async ws => { await core.createUsers(ws, profiles, PER); });
  console.log(`-- accounts ready: ${(Date.now() - t0) / 1000}s`);
  // shared master data (chart of accounts, items ...) so that the screens have real data to work with
  await core.pool(wss, WS, async ws => { for (const p of profiles) { if (!p.setup) continue; try { await p.setup(ws); } catch (e) { console.log(`  setup ${p.id} ws${ws.i}: ${e.message}`); } } });
  console.log(`-- master data ready: ${(Date.now() - t0) / 1000}s`);

  let jobs = [];
  for (const ws of wss) for (let n = 0; n < PER; n++) if (ws.clients[n]) jobs.push({ ws, n, p: profiles[n % profiles.length] });
  if (argv.role) jobs = jobs.filter(j => j.p.id === argv.role);
  if (argv.users) jobs = jobs.slice(0, Number(argv.users));
  console.log(`-- ${jobs.length} users to walk`);
  let browser = null;
  for (const ch of (argv.channel ? [argv.channel] : [undefined, 'msedge', 'chrome'])) {
    try { browser = await chromium.launch({ headless: !argv.headed, channel: ch }); console.log(`-- browser: ${ch || 'bundled chromium'}`); break; } catch (e) { /* try next */ }
  }
  if (!browser) { console.error('No browser could be started. Install Edge/Chrome or run: npx playwright install chromium'); process.exit(1); }
  let done = 0;
  const all = await core.pool(jobs, PARALLEL, async job => {
    const r = await walkUser(browser, job);
    done++; process.stdout.write(`\r  ${done}/${jobs.length} users walked  `);
    return r;
  });
  await browser.close();
  process.stdout.write('\n');
  const flat = all.map((r, i) => r && !r.error ? r : (r && r.user ? r : { user: core.uname(jobs[i].ws.i, jobs[i].n), profile: jobs[i].p.id, ws: jobs[i].ws.i, screens: [], error: r && r.error ? String(r.error.message || r.error) : 'unknown' }));
  const md = report(flat, t0);
  fs.writeFileSync(path.join(__dirname, `ui-report-${APP}.md`), md);
  fs.writeFileSync(path.join(__dirname, `ui-report-${APP}.json`), JSON.stringify(flat, null, 1));
  const scr = flat.flatMap(r => r.screens);
  const sum = f => scr.reduce((a, s) => a + f(s), 0);
  console.log(`\n===== ${flat.length} users, ${scr.length} screen visits, forms saved ${sum(s => s.stats.saved)}/${sum(s => s.stats.forms)}, refused ${sum(s => s.stats.refused.length)}, 5xx ${sum(s => s.http5xx.length)}, JS errors ${sum(s => s.jsErrors.length + s.consoleErrors.length)}, sign-in failures ${flat.filter(r => r.error).length} =====`);
  console.log(`Report: ui/ui-report-${APP}.md and .json (send me either file)`);
})().catch(e => { console.error(e); process.exit(1); });
