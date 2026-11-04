@echo off
rem One click: always rebuilds the app, then makes installers\WorkflowERP-WPF-Setup.exe - a normal Windows setup program.
cd /d "%~dp0"
set NOLAUNCH=1
call build-exe.bat
if errorlevel 1 ( echo. & echo BUILD FAILED - read the message above. & pause & exit /b 1 )
call ..\tools\make-installer.bat WPF "%~dp0dist" WorkflowErp.exe 50EF39C8-5AD4-41C9-85CF-95199C3A536C
if errorlevel 1 ( echo. & echo INSTALLER FAILED - read the message above. & pause & exit /b 1 )
explorer "%~dp0..\installers"
