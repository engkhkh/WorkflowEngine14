from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m: errs.append('C:'+m.text[:200]) if m.type=='error' and 'TUNNEL' not in m.text and 'googleapis' not in m.text else None)
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(600); pg.click('text=Create')
    for n,v in [('ws','Acme Shop'),('branch','HQ'),('dn','Admin'),('un','adm'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_url('**/setup'); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4200/website'); pg.wait_for_timeout(1000)
    pg.click('button.primary:has-text("New website")'); pg.wait_for_timeout(300)
    pg.fill('.modal input','Coffee House'); pg.screenshot(path='w1.png')
    pg.click('.modal-foot .primary'); pg.wait_for_url('**/website/s*'); pg.wait_for_timeout(1500)
    pg.screenshot(path='w2.png')
    fr=pg.frame_locator('iframe')
    # click hero in preview -> properties show
    fr.locator('.hero').click(); pg.wait_for_timeout(500)
    assert pg.locator('.right h4').inner_text().strip().lower().startswith('hero'), pg.locator('.right h4').inner_text()
    pg.locator('.right .fld input').first.fill('Fresh coffee, roasted daily'); pg.wait_for_timeout(600)
    assert fr.locator('h1').inner_text()=='Fresh coffee, roasted daily'
    # sync products from POS
    pg.click('.ptabs button:nth-child(5)'); pg.click('text=Sync products'); pg.wait_for_timeout(800)
    assert pg.locator('.pr').count()==2
    pg.click('.ptabs button:nth-child(1)'); pg.wait_for_timeout(200)
    pg.screenshot(path='w3.png')
    # add a FAQ block
    pg.click('.pal button:has-text("FAQ")'); pg.wait_for_timeout(600)
    # undo
    pg.click('button[title="Undo"]'); pg.wait_for_timeout(400)
    # mobile
    pg.click('.seg button:nth-child(3)'); pg.wait_for_timeout(500); pg.screenshot(path='w4.png'); pg.click('.seg button:nth-child(1)')
    # publish
    pg.wait_for_timeout(2200); pg.click('.bar .primary'); pg.wait_for_timeout(300); pg.click('.modal-foot .primary'); pg.wait_for_timeout(1200)
    url=pg.locator('.modal input[readonly]').input_value(); print(url); pg.screenshot(path='w5.png')
    # visitor: shop
    v=b.new_page(viewport={'width':1200,'height':900}); v.on('pageerror',lambda e:errs.append('V:'+str(e)))
    v.goto(url); v.wait_for_timeout(800)
    v.locator('[data-add="SKU1"]').first.click(); v.wait_for_timeout(300); v.locator('[data-add="SKU1"]').first.click() if v.locator('[data-drawer].open').count()==0 else None
    v.screenshot(path='w6.png')
    v.fill('[data-checkout] input[name=name]','Visitor One'); v.fill('[data-checkout] input[name=phone]','0500000000'); v.click('[data-checkout] button[type=submit]'); v.wait_for_timeout(1000)
    msg=v.locator('[data-ostatus]').inner_text(); print(msg); assert 'WO-' in msg
    v.screenshot(path='w7.png')
    b.close(); print('errs',errs)
