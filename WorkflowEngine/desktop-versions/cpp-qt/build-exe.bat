@echo off
setlocal enabledelayedexpansion
rem Builds dist\workflow-erp.exe with Qt 6 (MSVC or MinGW kit) and CMake.
rem Finds Qt by itself (looks for windeployqt.exe on drive C:). Or set it yourself first:  set QT_DIR=C:\Qt\6.7.2\msvc2019_64
cd /d "%~dp0"

if "%QT_DIR%"=="" (
  echo Looking for Qt on C: ...
  for /f "delims=" %%F in ('dir /s /b "C:\windeployqt.exe" 2^>nul ^| findstr /i "6\.[0-9]*\.[0-9]*" ^| findstr /i /v "android ios wasm"') do set "WD=%%F"
)
if "%QT_DIR%"=="" if not "%WD%"=="" for %%A in ("%WD%\..\..") do set "QT_DIR=%%~fA"
if "%QT_DIR%"=="" (
  echo.
  echo Qt 6 was not found on C:.  Run the Qt installer again and tick "Qt 6.x - MSVC 2019/2022 64-bit" ^(or MinGW 64-bit^).
  echo Or find the folder that has bin\windeployqt.exe and run:   set QT_DIR=that folder   then run this file again.
  pause & exit /b 1
)
echo Using Qt: %QT_DIR%

set "GEN="
echo %QT_DIR% | findstr /i "mingw" >nul && set "MINGW=1"
if defined MINGW (
  set "GEN=-G "MinGW Makefiles""
  for /d %%T in ("%QT_DIR%\..\..\Tools\mingw*_64") do set "PATH=%%~fT\bin;!PATH!"
  for /d %%T in ("%QT_DIR%\..\..\Tools\CMake_64") do set "PATH=%%~fT\bin;!PATH!"
  for /d %%T in ("%QT_DIR%\..\..\Tools\Ninja") do set "PATH=%%~fT;!PATH!"
)
where cmake >nul 2>nul || (echo CMake not found. Install it from https://cmake.org/download/ ^(tick "add to PATH"^) & pause & exit /b 1)

cmake -S . -B build %GEN% -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="%QT_DIR%" || (pause & exit /b 1)
cmake --build build --config Release || (pause & exit /b 1)

if not exist dist mkdir dist
if exist build\Release\workflow-erp.exe (copy /y build\Release\workflow-erp.exe dist\ >nul) else (copy /y build\workflow-erp.exe dist\ >nul)
"%QT_DIR%\bin\windeployqt.exe" dist\workflow-erp.exe
echo Done: %~dp0dist\workflow-erp.exe
if not defined NOLAUNCH start "" "%~dp0dist\workflow-erp.exe"
