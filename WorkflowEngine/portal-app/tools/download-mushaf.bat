@echo off
REM Downloads the 604 Mushaf page images into src\assets\mushaf so the Quran reader works offline / on your own server.
REM Afterwards open Holy Quran > Mushaf > "Image source" and enter:  assets/mushaf/
REM (about 60 MB; run once, from the portal-app folder)
cd /d "%~dp0.."
if not exist src\assets\mushaf mkdir src\assets\mushaf
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; 1..604 | ForEach-Object { $n='{0:D3}.png' -f $_; $f='src\assets\mushaf\'+$n; if (-not (Test-Path $f)) { Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/GovarJabbar/Quran-PNG/master/'+$n) -OutFile $f }; if ([math]::Floor($_ / 50) * 50 -eq $_) { Write-Host ('{0} / 604' -f $_) } }"
if errorlevel 1 ( echo Download failed - check the internet connection and run again. & pause & exit /b 1 )
echo Done. Set the Image source to assets/mushaf/ and rebuild the portal.
pause
