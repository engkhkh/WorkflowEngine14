@echo off
rem First run creates a private Python environment and installs PySide6, later runs start at once.
cd /d "%~dp0"
if not exist .venv ( py -3 -m venv .venv || (echo Install Python 3.10+ from python.org & pause & exit /b 1) )
if not exist .venv\.ready ( .venv\Scripts\python -m pip install -r requirements.txt && echo ok> .venv\.ready )
start "" .venv\Scripts\pythonw main.py
