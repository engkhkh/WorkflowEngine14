@echo off
rem make-installer.bat <Variant> <SrcDir> <ExeName> <Guid>
rem Wraps an already built app folder into  installers\WorkflowERP-<Variant>-Setup.exe  using Inno Setup 6
rem (installs to the user's Programs folder, Start menu + desktop shortcut, uninstaller, starts the app at the end).
setlocal
set "VARIANT=%~1" & set "SRC=%~2" & set "EXE=%~3" & set "GUID=%~4"
set "HERE=%~dp0"
set "OUT=%HERE%..\installers"
if not exist "%OUT%" mkdir "%OUT%"
if not exist "%SRC%\%EXE%" ( echo Built app not found: %SRC%\%EXE% & exit /b 1 )

set "ISCC="
for %%P in ("%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" "%ProgramFiles%\Inno Setup 6\ISCC.exe" "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe") do if exist %%P set "ISCC=%%~P"
if not defined ISCC (
  echo Inno Setup 6 is not installed - installing it with winget ...
  winget install --id JRSoftware.InnoSetup -e --silent --accept-package-agreements --accept-source-agreements
  for %%P in ("%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" "%ProgramFiles%\Inno Setup 6\ISCC.exe" "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe") do if exist %%P set "ISCC=%%~P"
)
if not defined ISCC (
  echo.
  echo Could not find or install Inno Setup. Download it from https://jrsoftware.org/isdl.php , install it, then run this again.
  exit /b 1
)
"%ISCC%" /Q "/DVariant=%VARIANT%" "/DSrcDir=%SRC%" "/DExeName=%EXE%" "/DAppGuid=%GUID%" "/DOutDir=%OUT%" "%HERE%installer.iss" || exit /b 1
echo.
echo Installer ready: %OUT%\WorkflowERP-%VARIANT%-Setup.exe
exit /b 0
