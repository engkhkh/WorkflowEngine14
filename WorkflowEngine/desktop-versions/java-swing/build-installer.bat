@echo off
rem One click: builds the jar, bundles a private Java runtime (jpackage, JDK 17+ needed on this PC) and makes
rem installers\WorkflowERP-Java-Setup.exe - a normal Windows setup program (the user needs no Java).
cd /d "%~dp0"
call build.bat || ( pause & exit /b 1 )
if exist dist rmdir /s /q dist
if exist jpkg-in rmdir /s /q jpkg-in
mkdir jpkg-in
copy /y workflow-erp.jar jpkg-in\ >nul
jpackage --type app-image --name WorkflowErp --input jpkg-in --main-jar workflow-erp.jar --main-class erp.Main --dest dist --java-options "-Dfile.encoding=UTF-8" || ( echo jpackage failed - install a full JDK 17 or newer & pause & exit /b 1 )
call ..\tools\make-installer.bat Java "%~dp0dist\WorkflowErp" WorkflowErp.exe 7CB900AE-D97A-4E2F-ABC8-874EB880C7F6 || ( pause & exit /b 1 )
explorer "%~dp0..\installers"
