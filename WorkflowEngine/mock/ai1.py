from playwright.sync_api import sync_playwright
def say(pg,t,wait=900):
    pg.fill('.assistant-panel textarea, .ai-panel textarea, aside textarea, textarea', t) if False else None
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m: errs.append('C:'+m.text[:200]) if m.type=='error' and 'TUNNEL' not in m.text and 'googleapis' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','Acme'),('branch','HQ'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/dashboard'); pg.wait_for_timeout(1000)
    pg.click('button:has-text("AI Assistant")'); pg.wait_for_timeout(500)
    inp='app-assistant-panel input, app-assistant-panel textarea'
    print('input count', pg.locator(inp).count())
    def say(t):
        n=pg.locator('app-assistant-panel .msg, app-assistant-panel .bubble, app-assistant-panel .m').count()
        pg.fill(inp,t); pg.keyboard.press('Enter'); pg.wait_for_timeout(1200)
        print('>',t,'\n  ',pg.locator('app-assistant-panel .msg:not(.me) .bubble > div:first-child').last.inner_text())
    say('create module Fleet with fields plate, model, year (number), service date, status (active / sold)')
    print('sidebar custom link:', pg.locator('nav a:has-text("Fleet")').count())
    say('add field Colour to Fleet')
    say('remove field model from Fleet')
    say('make year required in Fleet')
    say('rename field Colour to Paint in Fleet')
    say('create module visitors')
    say('أنشئ وحدة السيارات بحقول: الرقم، الموديل، السنة (number)، تاريخ الصيانة')
    say('rename module visitors to Guests')
    say('list my modules')
    say('rename Dashboard to Home')
    print('sidebar has Home:', pg.locator('nav a:has-text("Home")').count())
    say('reset names')
    say('delete module Guests'); say('no')
    say('delete module Guests'); say('yes')
    say('add field X to Nothing')
    pg.screenshot(path='a1.png')
    # page
    pg.goto('http://localhost:4200/custom/fleet'); pg.wait_for_timeout(1000)
    print('cols', pg.locator('table.data th').all_inner_texts())
    pg.click('button.primary:has-text("New record")'); pg.wait_for_timeout(300)
    pg.click('.modal-foot .primary'); pg.wait_for_timeout(500); print('required msg:', pg.locator('.modal .flash.bad').inner_text())
    pg.fill('.modal input >> nth=0','ABC-123'); pg.fill('.modal input[type=number]','2022'); pg.select_option('.modal select','Active'); pg.click('.modal-foot .primary'); pg.wait_for_timeout(700)
    print('rows', pg.locator('table.data tbody tr').count(), pg.locator('table.data tbody tr').first.inner_text().replace('\n',' '))
    pg.screenshot(path='a2.png')
    b.close(); print('errs',errs)
