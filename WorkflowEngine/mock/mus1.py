from playwright.sync_api import sync_playwright
import datetime, json, re
SUR=[{"number":1,"name":"سورة الفاتحة","englishName":"Al-Faatiha","englishNameTranslation":"The Opening","numberOfAyahs":7,"revelationType":"Meccan"},
     {"number":112,"name":"سورة الإخلاص","englishName":"Al-Ikhlaas","englishNameTranslation":"Sincerity","numberOfAyahs":4,"revelationType":"Meccan"}]
EDS=[{"identifier":"quran-uthmani","language":"ar","name":"Uthmani","englishName":"Uthmani","format":"text","type":"quran"},
     {"identifier":"en.sahih","language":"en","name":"Saheeh International","englishName":"Saheeh","format":"text","type":"translation"},
     {"identifier":"fr.hamidullah","language":"fr","name":"Hamidullah","englishName":"Hamidullah","format":"text","type":"translation"},
     {"identifier":"ar.muyassar","language":"ar","name":"Tafsir Muyassar","englishName":"Muyassar","format":"text","type":"tafsir"}]
def surah(n,ed):
    cnt=SUR[0 if n==1 else 1]["numberOfAyahs"]; base=(0 if n==1 else 6222)
    ay=[]
    for i in range(1,cnt+1):
        t={"quran-uthmani":("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ " if (i==1 and n==112) else "")+f"آية {i}","en.sahih":f"Translation {n}:{i}","ar.muyassar":f"تفسير {n}:{i}"}.get(ed,f"{ed} {n}:{i}")
        ay.append({"number":base+i,"text":t,"numberInSurah":i})
    d=dict(SUR[0 if n==1 else 1]); d["ayahs"]=ay; return d
def handle(route):
    u=route.request.url; path=u.split('/v1',1)[1]; calls.append(path)
    def ok(d): route.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body=json.dumps({"code":200,"status":"OK","data":d}))
    if path.startswith('/surah/'):
        m=re.match(r'/surah/(\d+)/(.+)',path); return ok(surah(int(m.group(1)),m.group(2)))
    if path=='/surah': return ok(SUR)
    if path.startswith('/edition'): return ok(EDS)
    if path.startswith('/ayah/'):
        m=re.match(r'/ayah/([^/]+)/(.+)',path); return ok({"number":1,"text":f"{m.group(2)} text of {m.group(1)}","numberInSurah":1})
    route.fulfill(status=404,body='')
calls=[]
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900}, timezone_id='Europe/London', locale='en-GB'); pg=ctx.new_page(); errs=[]
    ctx.grant_permissions(['notifications'])
    pg.route('https://api.alquran.cloud/**',handle); pg.route('https://cdn.islamic.network/**',lambda r:r.fulfill(status=200,body=b'',content_type='audio/mpeg'))
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m: errs.append('C:'+m.text[:200]) if m.type=='error' and 'TUNNEL' not in m.text and 'googleapis' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','Acme'),('branch','HQ'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/muslim'); pg.wait_for_timeout(1500); print(pg.url)
    print('place:', pg.locator('.place').inner_text(), '|', pg.locator('.dates').inner_text())
    print('next:', pg.locator('.next').inner_text(), pg.locator('.cd').inner_text())
    print('times:', [r.inner_text().replace('\n',' ') for r in pg.locator('.prow').all()])
    pg.screenshot(path='m1.png',full_page=True)
    # change country to Egypt -> Cairo, method egypt
    pg.select_option('app-muslim-times select >> nth=0','EG'); pg.wait_for_timeout(500)
    print('cairo:', pg.locator('.place').inner_text(), [r.inner_text().replace('\n',' ') for r in pg.locator('.prow').all()][:3], 'method:', pg.locator('app-muslim-times select >> nth=3').input_value())
    pg.select_option('app-muslim-times select >> nth=1','Alexandria'); pg.wait_for_timeout(300); print('city', pg.locator('.place').inner_text())
    # custom coords
    pg.fill('input[type=number] >> nth=0','35.6892'); pg.fill('input[type=number] >> nth=1','51.389'); pg.wait_for_timeout(300); print('custom', pg.locator('.place').inner_text())
    pg.click('.seg button:has-text("This month")'); pg.wait_for_timeout(300); print('month rows', pg.locator('table.data tbody tr').count()); pg.click('.seg button:has-text("Today")')
    # reminder test: toast with verse + explanation
    pg.click('button:has-text("Test reminder")'); pg.wait_for_timeout(1500); print('toast:', pg.locator('.toast').first.inner_text().replace('\n',' | ')); pg.screenshot(path='m2.png')
    print('verse card:', pg.locator('.ar').first.inner_text()[:60])
    # quran
    pg.goto('http://localhost:4200/muslim/quran'); pg.wait_for_timeout(1000); print('surahs', pg.locator('.items button').count())
    pg.click('.items button:has-text("Al-Ikhlaas")'); pg.wait_for_timeout(1200); print('ayahs', pg.locator('.ayah').count(), '| first ar:', pg.locator('.ayah .ar').first.inner_text()[:40])
    pg.click('.ayah >> nth=0 >> button:has-text("Explanation")'); pg.wait_for_timeout(300); print('tafsir:', pg.locator('.tf').first.inner_text())
    print('basmala shown once:', pg.locator('.basmala').count(), 'tr:', pg.locator('.tr').first.inner_text())
    pg.click('.ayah >> nth=1 >> button:has-text("★")'); pg.screenshot(path='m3.png')
    pg.select_option('.bar select >> nth=0','fr.hamidullah'); pg.wait_for_timeout(800); print('fr tr:', pg.locator('.tr').first.inner_text())
    # arabic UI
    pg.goto('http://localhost:4200/muslim/times'); pg.wait_for_timeout(800)
    pg.evaluate("localStorage.setItem('portal_lang','ar')"); pg.reload(); pg.wait_for_timeout(1500); print('ar:', pg.locator('.prow').first.inner_text().replace('\n',' '), '|', pg.locator('.dates').inner_text()); pg.screenshot(path='m4.png',full_page=True)
    print('api calls', len(calls), calls[:6])
    b.close(); print('errs',errs)
