#!/bin/sh
# Needs a JDK 17 or newer. Produces workflow-erp.jar - run it with: java -jar workflow-erp.jar
set -e
rm -rf out && mkdir -p out
javac -encoding UTF-8 -d out $(find src/main/java -name '*.java')
cp src/main/resources/*.json src/main/resources/*.ttf out/
printf 'Main-Class: erp.Main\n' > out/manifest.txt
jar cfm workflow-erp.jar out/manifest.txt -C out erp -C out catalog.json -C out i18n.json -C out workflow.json -C out dashboard.json -C out hospital.json -C out finance.json -C out hr.json -C out ops.json -C out website.json -C out custom.json -C out admin.json -C out muslim.json -C out mushaf-text.json -C out mushaf-index.json -C out AmiriQuran-Regular.ttf
echo "built workflow-erp.jar"
