@echo off
rem Builds dist\WorkflowErp\WorkflowErp.exe with PyInstaller (needs Python 3.9+ from python.org, "Add to PATH" ticked).
cd /d "%~dp0"
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY ( python --version >nul 2>nul && set "PY=python" )
if not defined PY (
  echo Python 3 was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH", then run this again.
  exit /b 1
)
echo Using: %PY%
if not exist .venv\Scripts\python.exe ( %PY% -m venv .venv || ( echo Could not create the virtual environment & exit /b 1 ) )
.venv\Scripts\python -m pip install --upgrade pip >nul 2>nul
.venv\Scripts\python -m pip install -r requirements.txt pyinstaller || ( echo pip install failed - check the internet connection / proxy & exit /b 1 )
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build
.venv\Scripts\python -m PyInstaller --noconfirm --windowed --name WorkflowErp --add-data "data;data" --collect-data tzdata --collect-all hijridate main.py || ( echo PyInstaller failed & exit /b 1 )
if not exist dist\WorkflowErp\WorkflowErp.exe ( echo The exe was not created & exit /b 1 )
echo Done: %~dp0dist\WorkflowErp\WorkflowErp.exe
if not defined NOLAUNCH start "" "%~dp0dist\WorkflowErp\WorkflowErp.exe"
