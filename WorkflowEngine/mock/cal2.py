from playwright.sync_api import sync_playwright
import datetime
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1300,'height':800}); pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','Acme'),('branch','HQ'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/dashboard'); pg.wait_for_timeout(800)
    s=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=3)).isoformat()
    e=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=33)).isoformat()
    r=pg.evaluate("""async ([s,e])=>{ const t=localStorage.getItem('portal_token')||Object.keys(localStorage).map(k=>localStorage.getItem(k)).find(v=>v&&v.startsWith('tok-')); const r=await fetch('http://localhost:5000/api/calendar/events',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+t},body:JSON.stringify({kind:'meeting',title:'Board call',start:s,end:e,remindMinutes:5})}); return r.status; }""",[s,e])
    print('create',r)
    pg.reload(); pg.wait_for_timeout(4000)
    print('toast:', pg.locator('.toast').all_inner_texts())
    pg.screenshot(path='c8.png')
    b.close(); print(errs)
