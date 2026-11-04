from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':850}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    # admin creates an invited user with Jeddah-only access, through the admin page
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','Beta Co'),('branch','Cairo'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/admin'); pg.wait_for_timeout(1000)
    pg.click('button.primary:has-text("New")'); pg.wait_for_timeout(500)
    ins=pg.locator('.modal input[type=text], .modal input:not([type])')
    ins.nth(0).fill('lina'); ins.nth(1).fill('Lina K')
    pg.screenshot(path='a1.png')
    pg.click('.modal-foot .primary'); pg.wait_for_timeout(800)
    link=pg.locator('.modal input[readonly]').input_value(); print(link); assert 'accept-invite?token=' in link
    pg.screenshot(path='a2.png')
    pg.context.clear_cookies(); pg.evaluate("localStorage.clear()")
    pg.goto(link); pg.wait_for_timeout(900); pg.screenshot(path='a3.png')
    pg.fill('input[name=pw]','abcdef'); pg.fill('input[name=pw2]','abcdef'); pg.click('button.primary'); pg.wait_for_timeout(1200)
    print(pg.url); assert 'accept-invite' not in pg.url
    # re-using the link fails
    pg.evaluate("localStorage.clear()"); pg.goto(link); pg.wait_for_timeout(800)
    assert pg.locator('text=invalid or has expired').count()==1
    # Arabic
    b.close(); print('errs',errs)
