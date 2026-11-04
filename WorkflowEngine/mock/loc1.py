from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for loc,tz in [('de-DE','Europe/Berlin'),('ja-JP','Asia/Tokyo'),('en-US','America/New_York'),('ar-SA','Asia/Riyadh')]:
        c=b.new_context(locale=loc,timezone_id=tz); pg=c.new_page(); hdr=set()
        pg.on('request',lambda r: hdr.add(r.headers.get('x-tz-offset')) if ':5000' in r.url else None)
        pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(900)
        btns=[x.inner_text() for x in pg.locator('button, a').all()][:12]
        # toggle to signup: the last link/button that is not submit
        pg.locator('.go').first.wait_for(timeout=3000)
        sw=pg.locator('button.link, a.link, .switch, .alt button').first
        if sw.count(): sw.click()
        pg.wait_for_timeout(400)
        print(loc, 'ctry=',pg.input_value('input[name=ctry]') if pg.locator('input[name=ctry]').count() else None,
              'cur=',[pg.locator(s).first.input_value() for s in ['select[name=cur]','select[name=currency]','input[name=cur]','input[name=currency]'] if pg.locator(s).count()], set(hdr))
        c.close()
    b.close()
