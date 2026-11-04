from playwright.sync_api import sync_playwright
import json, re, os
Q='/tmp/claude-0/-home-claude/fbf4bbeb-4e13-5649-ba70-e5982bf196a3/scratchpad/q/'
reqs=[]
def img(route):
    n=re.search(r'/(\d{3})\.png',route.request.url).group(1); reqs.append(n)
    f=Q+n+'.png'
    if os.path.exists(f): route.fulfill(status=200,body=open(f,'rb').read(),content_type='image/png')
    else: route.fulfill(status=404,body='')
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900},timezone_id='Europe/London',locale='en-GB'); pg=ctx.new_page(); errs=[]
    pg.route('https://cdn.jsdelivr.net/gh/GovarJabbar/**',img)
    pg.route('https://api.alquran.cloud/**',lambda r:r.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body=json.dumps({"code":200,"data":[{"number":1,"name":"الفاتحة","englishName":"Al-Faatiha","englishNameTranslation":"The Opening","numberOfAyahs":7,"revelationType":"Meccan"},{"number":2,"name":"البقرة","englishName":"Al-Baqara","englishNameTranslation":"The Cow","numberOfAyahs":286,"revelationType":"Medinan"},{"number":3,"name":"آل عمران","englishName":"Aal-i-Imraan","englishNameTranslation":"The Family of Imraan","numberOfAyahs":200,"revelationType":"Medinan"}]})))
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m: errs.append('C:'+m.text[:200]) if m.type=='error' and 'Failed to load resource' not in m.text and 'googleapis' not in m.text else None)
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','Acme'),('branch','HQ'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/muslim/quran'); pg.wait_for_timeout(2000)
    print('imgs',pg.locator('.pg-box img').count(), 'page val', pg.locator('.pg input').input_value(), 'where', pg.locator('.where').inner_text())
    pg.screenshot(path='q1.png')
    pg.click('.nav >> nth=0'); pg.wait_for_timeout(800)  # next (left arrow button first)
    print('after next', pg.locator('.pg input').input_value(), reqs[-3:])
    pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(600); print('key next', pg.locator('.pg input').input_value())
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(300); print('key prev', pg.locator('.pg input').input_value())
    pg.click('.items button >> nth=2'); pg.wait_for_timeout(800); print('surah3 ->', pg.locator('.pg input').input_value(), pg.locator('.where').inner_text())
    pg.click('button.wide'); pg.wait_for_timeout(800); pg.screenshot(path='q4.png'); print('spread imgs', pg.locator('.pg-box').count(), [c.inner_text() for c in pg.locator('.pg-box figcaption').all()])
    pg.click('button[title="Night mode"]'); pg.wait_for_timeout(300); pg.screenshot(path='q2.png')
    pg.click('button[title="Night mode"]'); pg.click('button.wide'); pg.fill('.pg input','300'); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    print('missing page shows error:', pg.locator('.miss').count(), 'retry btn', pg.locator('.miss button').count())
    pg.click('text=Text with translation'); pg.wait_for_timeout(800); print('text view url', pg.url, pg.locator('.reader').count())
    pg.click('text=Mushaf (pages)'); pg.wait_for_timeout(500); print('back to mushaf', pg.locator('app-mushaf-reader').count())
    pg.set_viewport_size({'width':390,'height':800}); pg.wait_for_timeout(500); pg.screenshot(path='q3.png')
    print('errs',errs[:5])
