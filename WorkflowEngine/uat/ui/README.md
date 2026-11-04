# UI walk (real browser, every screen and button)
Run everything from THIS folder (uat\ui):
  cd uat\ui
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="1" ; npm i      # no browser download: uses your installed Edge/Chrome
  $env:API="http://127.0.0.1:5000"
  node walk.js --app=portal --base=http://localhost:4200 --ws=10 --parallel=15
  node walk.js --app=mobile --base=http://localhost:8100 --ws=10 --parallel=15
Quick check: add --users=5 --headed.  Force a browser: --channel=msedge or --channel=chrome.
