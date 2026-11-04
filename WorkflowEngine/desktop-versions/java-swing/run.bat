@echo off
cd /d "%~dp0"
if not exist workflow-erp.jar call build.bat
start "" javaw -jar workflow-erp.jar
