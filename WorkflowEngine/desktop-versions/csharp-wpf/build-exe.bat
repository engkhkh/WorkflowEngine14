@echo off
rem Builds dist\WorkflowErp.exe (self-contained, no .NET needed to run it). Needs the .NET 8 SDK (or newer) on this PC.
cd /d "%~dp0"
rem the old exe may still be running (or locked) - that is what makes "GenerateBundle ... access denied"
taskkill /f /im WorkflowErp.exe >nul 2>nul
timeout /t 1 /nobreak >nul
if exist dist rmdir /s /q dist
if exist dist (
  echo Could not delete the dist folder - close any window or Explorer preview that uses it, or an antivirus scan, and run again.
  exit /b 1
)
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist || (echo Build failed & exit /b 1)
echo.
echo Done: %~dp0dist\WorkflowErp.exe  (keep the dist folder together)
if not defined NOLAUNCH start "" "%~dp0dist\WorkflowErp.exe"
