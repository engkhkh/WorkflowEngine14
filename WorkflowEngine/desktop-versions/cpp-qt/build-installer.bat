@echo off
rem One click: always rebuilds the app, then makes installers\WorkflowERP-Qt-Setup.exe - a normal Windows setup program.
cd /d "%~dp0"
set NOLAUNCH=1
call build-exe.bat
if errorlevel 1 ( echo. & echo BUILD FAILED - read the message above. & pause & exit /b 1 )
call ..\tools\make-installer.bat Qt "%~dp0dist" workflow-erp.exe ABD91C22-654A-4F1A-AB28-6FE85F3A4C76
if errorlevel 1 ( echo. & echo INSTALLER FAILED - read the message above. & pause & exit /b 1 )
explorer "%~dp0..\installers"
