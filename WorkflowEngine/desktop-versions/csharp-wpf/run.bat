@echo off
cd /d "%~dp0"
if exist dist\WorkflowErp.exe (start "" dist\WorkflowErp.exe) else (call build-exe.bat)
