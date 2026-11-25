@echo off
rem Fills the workspace of the EXISTING built-in user "admin" (password admin123) with realistic data in every module.
rem Start the backend first. The script finds its port by itself (63353, 5000 ...). Use a TEST database. Node 18+ required.
rem --years=5 adds 5 years of history (60 monthly rounds of every module, records dated back month by month); it takes roughly 10-30 minutes.
rem To force an address:  set API=http://localhost:PORT   To use another user/password: set ADMIN_USER=... and set UAT_ADMIN_PASSWORD=...
cd /d "%~dp0..\..\uat"
node seed-admin.js --admin=3 --years=5
echo.
pause
