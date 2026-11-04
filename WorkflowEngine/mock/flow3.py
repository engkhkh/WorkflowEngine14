from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':850}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','Beta Co'),('branch','Cairo'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/admin?tab=billing'); pg.wait_for_timeout(1500); pg.screenshot(path='b1.png')
    pg.click('text=Pay now'); pg.wait_for_timeout(500); pg.screenshot(path='b2.png')
    pg.click('text=Mark as paid'); pg.wait_for_timeout(1200); pg.screenshot(path='b3.png')
    assert pg.locator('td .chip:has-text("Paid")').count()==1
    b.close(); print('errs',errs)
