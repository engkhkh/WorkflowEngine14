from playwright.sync_api import sync_playwright
import datetime, json
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900}, timezone_id='Asia/Riyadh', locale='en-GB'); pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m: errs.append('C:'+m.text[:200]) if m.type=='error' and 'TUNNEL' not in m.text and 'googleapis' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','Acme'),('branch','HQ'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/calendar'); pg.wait_for_timeout(1200); print(pg.url); pg.screenshot(path='c1.png')
    # sidebar entries
    print('sidebar', pg.locator('nav a:has-text("Calendar")').count(), pg.locator('nav a:has-text("Muslim")').count())
    # new event on today cell
    pg.click('button:has-text("Event") >> nth=0'); pg.wait_for_timeout(300)
    pg.fill('.modal input >> nth=0','Budget review'); pg.screenshot(path='c2.png')
    pg.click('.modal-foot .primary'); pg.wait_for_timeout(700)
    print('month items', pg.locator('.cell .ev').count())
    # meeting with attendee + assistant
    pg.click('button.primary:has-text("Video meeting")'); pg.wait_for_timeout(300)
    pg.fill('.modal input >> nth=0','Sprint sync')
    pg.check('.people label:has-text("Sara") input'); pg.click('.assist button:has-text("Suggest times")'); pg.wait_for_timeout(800)
    n=pg.locator('.slots button').count(); print('slots', n); pg.screenshot(path='c3.png')
    pg.click('.slots button >> nth=0'); pg.wait_for_timeout(500)
    print('busy', pg.locator('.busy li').all_inner_texts())
    pg.click('.modal-foot .primary'); pg.wait_for_timeout(900)
    # week view
    pg.click('.seg button:has-text("Week")'); pg.wait_for_timeout(600); print('blocks', pg.locator('.blk').count()); pg.screenshot(path='c4.png')
    pg.click('.seg button:has-text("Agenda")'); pg.wait_for_timeout(600); print('agenda rows', pg.locator('.arow').count())
    # open meeting & join (owner can always join)
    pg.click('.arow:has-text("Sprint sync")'); pg.wait_for_timeout(400); pg.screenshot(path='c5.png')
    pg.click('.modal button:has-text("Join meeting")'); pg.wait_for_url('**/calendar/room/*'); pg.wait_for_timeout(800)
    print('room:', pg.locator('button.big').inner_text(), '| iframe', pg.locator('iframe').count()); pg.screenshot(path='c6.png')
    # settings: own server -> embedded
    pg.goto('http://localhost:4200/calendar/settings'); pg.wait_for_timeout(600); pg.fill('input[placeholder="meet.jit.si"]','meet.example.com'); pg.click('button.primary'); pg.wait_for_timeout(500)
    pg.go_back() if False else None
    pg.goto('http://localhost:4200/calendar/view'); pg.wait_for_timeout(800); pg.click('.seg button:has-text("Agenda")'); pg.click('.arow:has-text("Sprint sync")'); pg.click('.modal button:has-text("Join meeting")'); pg.wait_for_url('**/calendar/room/*'); pg.wait_for_timeout(800)
    print('own server iframe', pg.locator('iframe').count(), pg.locator('iframe').get_attribute('src'))
    # todos
    pg.goto('http://localhost:4200/calendar/todos'); pg.wait_for_timeout(600); pg.fill('input[name=t]','Send invoices'); pg.click('form.add button.primary'); pg.wait_for_timeout(600)
    print('todos', pg.locator('.td').count()); pg.click('.td .ck'); pg.wait_for_timeout(500); pg.click('.seg button:has-text("Done")'); print('done', pg.locator('.td').count()); pg.screenshot(path='c7.png')
    # reminder toast: meeting starting in 3 minutes with reminder 5
    pg.goto('http://localhost:4200/calendar/view'); pg.wait_for_timeout(500)
    start=(datetime.datetime.utcnow()+datetime.timedelta(minutes=3)).isoformat()+'Z'
    pg.evaluate("""async (s)=>{ const t=localStorage.getItem('portal_token')||localStorage.getItem('token'); }""", start)
    b.close(); print('errs',errs)
