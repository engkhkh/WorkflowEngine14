from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.on('console',lambda m:print('C',m.type,m.text[:300])); pg.on('pageerror',lambda e:print('E',str(e)[:400]))
    pg.goto('http://localhost:4200/login'); pg.wait_for_timeout(800); pg.click('text=Create'); 
    for n,v in [('ws','A'),('dn','S'),('un','s'),('pw','secret1')]: pg.fill(f'input[name={n}]',v)
    pg.click('button.go'); pg.wait_for_timeout(2500); print(pg.url); b.close()
