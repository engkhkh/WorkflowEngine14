@echo off
rem Needs a JDK 17 or newer. Produces workflow-erp.jar - run it with: java -jar workflow-erp.jar
if exist out rmdir /s /q out
mkdir out
dir /s /b src\main\java\*.java > sources.txt
javac -encoding UTF-8 -d out @sources.txt || exit /b 1
del sources.txt
copy src\main\resources\*.json out\ >nul
copy src\main\resources\*.ttf out\ >nul
echo Main-Class: erp.Main> out\manifest.txt
jar cfm workflow-erp.jar out\manifest.txt -C out erp -C out catalog.json -C out i18n.json -C out workflow.json -C out dashboard.json -C out hospital.json -C out finance.json -C out hr.json -C out ops.json -C out website.json -C out custom.json -C out admin.json -C out muslim.json -C out mushaf-text.json -C out mushaf-index.json -C out AmiriQuran-Regular.ttf
echo built workflow-erp.jar
