@echo off
rem One click: always rebuilds the app, then makes installers\WorkflowERP-Python-Setup.exe - a normal Windows setup program.
cd /d "%~dp0"
set NOLAUNCH=1
call build-exe.bat
if errorlevel 1 ( echo. & echo BUILD FAILED - read the message above. & pause & exit /b 1 )
call ..\tools\make-installer.bat Python "%~dp0dist\WorkflowErp" WorkflowErp.exe 1E7AD0EE-5D09-4F05-8607-D2415D79DF89
if errorlevel 1 ( echo. & echo INSTALLER FAILED - read the message above. & pause & exit /b 1 )
explorer "%~dp0..\installers"
