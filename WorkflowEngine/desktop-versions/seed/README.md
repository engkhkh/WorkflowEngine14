# Test user with data in every module

Run `run-seed.bat` (backend running, Node 18+ installed). It uses `uat\seed.js` and creates a demo workspace with about 300 real records across finance, procurement, warehouse, manufacturing, CRM, sales, POS, projects, hospital, HR, payroll, assets, archive, real estate and more.

Sign in with **ldemow1u00 / Test@12345** (administrator, sees every module). The other users, one per module, are listed in `uat\seed-report.md` (same password).

To start again with fresh data use another tag:  `set API=http://localhost:63353 && node ..\..\uat\seed.js --tag=test2`  (users become `ltest2w1u00` ...).
