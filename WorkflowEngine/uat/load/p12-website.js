// Website manager: own site with pages and checkout form, publish, public address, one public visitor order, order handling.
// NOTE: the public order/message endpoints allow 6 calls per IP per 10 minutes, and all 100 users share one IP, so each user places exactly ONE rate-limited public order (the honeypot call returns before the limiter).
const { Client, BASE, must, refused, eq, ok } = require('../lib');
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = {
  id: 'website-manager',
  title: 'Website manager',
  modules: ['web'],
  role: 'employee',
  perms: ['web.*'],
  probe: { path: '/api/website/sites', perm: 'web.view' },

  async run(u) {
    const c = u.c, K = u.key, S = u.state;
    const NAME = `Shop ${K}`;
    const products = [{ sku: `GLV-${K}`, name: `Gloves box ${K}`, price: 26 }, { sku: `MSK-${K}`, name: `Masks box ${K}`, price: 15 }];
    const design = { pages: [{ id: 'home', title: 'Home', blocks: [{ type: 'hero', text: NAME }] }, { id: 'products', title: 'Products', blocks: [{ type: 'shop' }] }], checkout: { enabled: true } };
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${NAME}</title></head><body>
<section id="home"><h1>Home</h1><p>${NAME}</p></section>
<section id="products"><h2>Products</h2><ul>${products.map(p => `<li>${p.name} - SAR ${p.price}</li>`).join('')}</ul></section>
<form id="checkout" method="post"><input name="name"><input name="phone"><select name="sku"><option>${products[0].sku}</option></select><input name="qty"><button>Order</button></form>
</body></html>`;
    const orders = async () => must(await c.get(`/api/website/submissions?siteId=${S.site.id}&kind=order`), 'orders');

    await u.step('P12-01', 'Create the site: draft with a slug, not published; empty name refused', async () => {
      refused(await c.post('/api/website/sites', { name: '   ', design }), 'empty site name', [400]);
      const s = must(await c.post('/api/website/sites', { name: NAME, design, currency: 'SAR' }), 'create site');
      ok(s.slug && s.published === false, 'new site should be an unpublished draft with a slug');
      ok(s.slug.includes(K.toLowerCase()), 'slug ' + s.slug + ' does not contain the user key');
      eq(s.currency, 'SAR', 'currency'); S.site = s;
      ok(must(await c.get('/api/website/sites'), 'list').some(x => x.id === s.id), 'site not in the list');
      return 'slug ' + s.slug;
    });

    await u.step('P12-02', 'Pages: design saved with Home + Products + checkout form, renamed, read back', async () => {
      ok(S.site, 'depends on P12-01');
      const d2 = { ...design, pages: [...design.pages, { id: 'contact', title: 'Contact', blocks: [{ type: 'text', text: 'Reach us' }] }] };
      const sv = must(await c.put(`/api/website/sites/${S.site.id}`, { name: NAME + ' Online', design: d2 }), 'save design');
      eq(sv.name, NAME + ' Online', 'renamed');
      const g = must(await c.get(`/api/website/sites/${S.site.id}`), 'read site');
      eq(g.design.pages.length, 3, 'saved pages'); ok(g.design.checkout && g.design.checkout.enabled === true, 'checkout form flag lost');
      ok(g.design.pages.some(p => p.title === 'Products'), 'Products page missing');
      refused(await c.get('/api/website/sites/does-not-exist-' + K), 'unknown site', [404]);
      return '3 pages, checkout enabled';
    });

    await u.step('P12-03', 'Before publishing the public address does not serve the page; empty page cannot be published', async () => {
      ok(S.site, 'depends on P12-01');
      const pre = await fetch(BASE + '/s/' + S.site.slug);
      eq(pre.status, 404, 'unpublished public page');
      refused(await c.post(`/api/website/sites/${S.site.id}/publish`, { html: '   ', products }), 'publish empty page', [400]);
      return 'unpublished = 404';
    });

    await u.step('P12-04', 'Publish with price list: public address serves Home, Products, form, sandbox CSP', async () => {
      ok(S.site, 'depends on P12-01');
      const p = must(await c.post(`/api/website/sites/${S.site.id}/publish`, { html, products, currency: 'SAR' }), 'publish');
      ok(p.published === true && p.publishedAt, 'not published');
      const page = await fetch(BASE + '/s/' + S.site.slug);
      eq(page.status, 200, 'public page after publishing');
      const body = await page.text();
      ok(body.includes('Home') && body.includes('Products') && body.includes('<form') && body.includes(NAME), 'public page misses Home, Products, the form or the site name');
      ok(/sandbox/.test(page.headers.get('content-security-policy') || ''), 'no sandbox CSP');
      ok(must(await c.get('/api/website/sites'), 'list').find(x => x.id === S.site.id).published === true, 'list does not show published');
      return BASE + '/s/' + S.site.slug;
    });

    await u.step('P12-05', 'Unpublish takes the address down (404), republish brings it back', async () => {
      ok(S.site, 'depends on P12-01');
      const un = must(await c.post(`/api/website/sites/${S.site.id}/unpublish`, {}), 'unpublish'); eq(un.published, false, 'published flag');
      eq((await fetch(BASE + '/s/' + S.site.slug)).status, 404, 'page after unpublish');
      const re = must(await c.post(`/api/website/sites/${S.site.id}/publish`, { html, products, currency: 'SAR' }), 'republish'); eq(re.published, true, 'published flag');
      eq((await fetch(BASE + '/s/' + S.site.slug)).status, 200, 'page after republish');
      return 'down and up again';
    });

    await u.step('P12-06', 'Visitor (no sign-in) orders 3 + 2 gloves and 3 masks: lines merged, total 5 x 26 + 3 x 15 = 175.00', async () => {
      ok(S.site, 'depends on P12-01');
      const pub = new Client('public-' + K);
      const r = await pub.post(`/api/public/sites/${S.site.slug}/orders`, { name: 'Visitor ' + K, phone: '0500000' + u.tag, email: `visitor.${K}@example.com`.toLowerCase(), address: 'Dammam', note: 'order ' + K,
        lines: [{ sku: products[0].sku, qty: 3 }, { sku: products[0].sku, qty: 2 }, { sku: products[1].sku, qty: 3 }] });
      ok(r.status !== 429, 'public order rate limit (6 per address per 10 minutes) hit - shared test machine');
      const d = must(r, 'public order');
      ok(/^WO-\d{8}-\d{4}$/.test(d.number), 'order number format: ' + d.number); eq(d.total, 175, 'order total');
      S.order = d; return d.number + ' total ' + d.total;
    });

    await u.step('P12-07', 'Order appears in Orders: status new, lines merged to 2 with the frozen prices, total 175.00, VAT 15% = 26.25', async () => {
      ok(S.order, 'depends on P12-06');
      const o = (await orders()).find(x => x.number === S.order.number); ok(o, 'order not listed');
      S.orderRow = o; ok(o.status === 'new', 'status ' + o.status); eq(o.total, 175, 'stored total'); ok(o.currency === 'SAR', 'currency ' + o.currency);
      eq(o.lines.length, 2, 'merged lines');
      const g = o.lines.find(l => l.sku === products[0].sku), m = o.lines.find(l => l.sku === products[1].sku);
      ok(g && m, 'a line is missing'); eq(g.qty, 5, 'glove qty'); eq(g.price, 26, 'glove price'); eq(m.qty, 3, 'mask qty'); eq(m.price, 15, 'mask price');
      eq(r2(o.lines.reduce((s, l) => s + l.qty * l.price, 0)), o.total, 'lines add up to total');
      eq(r2(o.total * 0.15), 26.25, 'VAT 15%'); eq(r2(o.total * 1.15), 201.25, 'total incl. VAT');
      ok(o.name.includes(K) && (o.email || o.phone), 'customer details');
      return 'new, 175.00 (+26.25 VAT = 201.25)';
    });

    await u.step('P12-08', 'Honeypot: a bot order (Website field filled) pretends to work but no order is stored', async () => {
      ok(S.site && S.order, 'depends on P12-06');
      const pub = new Client('bot-' + K);
      const before = (await orders()).length;
      const r = must(await pub.post(`/api/public/sites/${S.site.slug}/orders`, { name: 'Bot ' + K, phone: '0500000000', Website: 'http://spam.example', lines: [{ sku: products[0].sku, qty: 1 }] }), 'bot order');
      eq(r.number, 'WO-0', 'bot answer');
      eq((await orders()).length, before, 'order count after bot');
      return 'bot ignored';
    });

    await u.step('P12-09', 'Process the order: unknown status refused; confirmed -> shipped -> done is saved', async () => {
      ok(S.orderRow, 'depends on P12-07');
      refused(await c.put(`/api/website/submissions/${S.orderRow.id}`, { status: 'processed' }), 'unknown status', [400]);
      for (const st of ['confirmed', 'shipped', 'done']) {
        const r = must(await c.put(`/api/website/submissions/${S.orderRow.id}`, { status: st }), 'set ' + st); eq(r.status, st, 'returned status');
      }
      eq((await orders()).find(x => x.id === S.orderRow.id).status, 'done', 'saved status');
      refused(await c.put('/api/website/submissions/nope-' + K, { status: 'done' }), 'unknown order', [404]);
      return 'done';
    });

    await u.step('P12-10', 'Cancel path and filters: a second status change to cancelled is saved; kind=message filter lists no orders', async () => {
      ok(S.orderRow, 'depends on P12-07');
      must(await c.put(`/api/website/submissions/${S.orderRow.id}`, { status: 'cancelled' }), 'cancel');
      eq((await orders()).find(x => x.id === S.orderRow.id).status, 'cancelled', 'cancelled saved');
      const msgs = must(await c.get(`/api/website/submissions?siteId=${S.site.id}&kind=message`), 'messages');
      ok(msgs.every(x => x.kind === 'message') && !msgs.some(x => x.id === S.orderRow.id), 'message filter returned orders');
      return 'cancelled, filters work';
    });

    await u.step('P12-11', 'A second site stays a draft: its public address is 404 and it lists as unpublished', async () => {
      ok(S.site, 'depends on P12-01');
      const s2 = must(await c.post('/api/website/sites', { name: `Draft ${K}`, design }), 'create draft site');
      S.draft = s2; eq(s2.published, false, 'draft flag');
      eq((await fetch(BASE + '/s/' + s2.slug)).status, 404, 'draft public page');
      ok(must(await c.get('/api/website/sites'), 'list').filter(x => x.name.includes(K)).length >= 2, 'both sites should be listed');
      return 'draft ' + s2.slug;
    });

    await u.step('P12-12', 'Delete the draft site (its orders go with it); the published site stays', async () => {
      ok(S.draft && S.site, 'depends on P12-11');
      let d = await c.del(`/api/website/sites/${S.draft.id}`); ok(d.ok, 'delete: HTTP ' + d.status);
      const list = must(await c.get('/api/website/sites'), 'list');
      ok(!list.some(x => x.id === S.draft.id), 'deleted site still listed'); ok(list.some(x => x.id === S.site.id), 'published site vanished');
      refused(await c.get(`/api/website/sites/${S.draft.id}`), 'deleted site by id', [404]);
      return 'deleted';
    });

    u.manual('P12-M1', 'Visual page designer, drag blocks, image upload', 'The designer runs in the browser; the API stores its JSON (checked in P12-02).');
    u.manual('P12-M2', 'Contact-form message from the public page', 'POST /api/public/sites/{slug}/messages shares the 6-per-address rate limit with orders, so 100 users on one address cannot test it without false 429s.');
  },
};
