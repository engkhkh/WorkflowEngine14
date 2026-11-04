@echo off
rem Fills ONE demo workspace with realistic data in every module and creates a test administrator.
rem 1) Start the backend first (dotnet run in backend\WorkflowEngine.Api)  2) Node 18+ must be installed.
rem Sign in to any desktop app (or the portal) with:   ldemow1u00  /  Test@12345   (server http://localhost:63353)
if "%API%"=="" set "API=http://localhost:63353"
cd /d "%~dp0..\..\uat"
node seed.js
echo.
echo Login:  ldemow1u00 / Test@12345   (administrator - sees every module)  - see uat\seed-report.md for the other users
pause
