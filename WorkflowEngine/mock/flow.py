from playwright.sync_api import sync_playwright
import re
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':850}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(800)
    pg.click('text=Create'); pg.wait_for_timeout(300)
    pg.fill('input[name=ws]','Acme Trading'); pg.fill('input[name=branch]','Riyadh HQ'); pg.fill('input[name=ctry]','Saudi Arabia')
    pg.fill('input[name=dn]','Sara Admin'); pg.fill('input[name=em]','sara@acme.test'); pg.fill('input[name=un]','sara'); pg.fill('input[name=pw]','secret1')
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(800)
    pg.screenshot(path='s1.png')
    assert 'Acme Trading' in pg.input_value('.wiz section input'), 'company prefilled'
    pg.click('text=Continue'); pg.wait_for_timeout(500)
    pg.fill('input[placeholder="Branch name"]','Jeddah'); pg.click('text=Add branch'); pg.wait_for_timeout(500)
    assert pg.locator('.wiz .row').count()==2, pg.locator('.wiz .row').count()
    pg.screenshot(path='s2.png'); pg.click('.nav .primary'); pg.wait_for_timeout(500)
    inputs=pg.locator('.wiz section .grid input')
    inputs.nth(0).fill('Omar Sales'); inputs.nth(2).fill('omar'); pg.locator('.brs input').nth(1).check()
    pg.click('button.primary:has-text("Invite")'); pg.wait_for_timeout(600); pg.screenshot(path='s3.png')
    assert pg.locator('.wiz .row').count()==1
    pg.click('.nav .primary'); pg.wait_for_timeout(300); pg.click('.nav .primary'); pg.wait_for_timeout(800)
    assert '/dashboard' in pg.url, pg.url
    assert pg.locator('.setup-banner').count()==0
    # invite link
    tok=[k for k in [None]]
    pg.goto('http://localhost:4200/admin'); pg.wait_for_timeout(1200); pg.screenshot(path='s4.png')
    assert pg.locator('text=Invited').count()>=1
    b.close(); print('errs',errs)
