from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m: errs.append('C:'+m.text[:200]) if m.type=='error' and 'TUNNEL' not in m.text and 'googleapis' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','City Hospital'),('branch','HQ'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/workflow'); pg.wait_for_timeout(1000); pg.screenshot(path='f1.png')
    pg.goto('http://localhost:4200/workflow/designer'); pg.wait_for_timeout(1200); pg.screenshot(path='f2.png')
    print('designer palette:', pg.locator('.palette').count(), 'toolbar btns', pg.locator('.toolbar button').count())
    pg.goto('http://localhost:4200/admin?tab=modules'); pg.wait_for_timeout(800)
    pg.click('.tabs button:has-text("Modules")'); pg.wait_for_timeout(800); pg.screenshot(path='f3.png')
    print('mods', pg.locator('.mod').count())
    b.close(); print('errs',errs)
