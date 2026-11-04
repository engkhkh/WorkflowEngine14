#!/bin/sh
# Downloads the 604 Mushaf page images into src/assets/mushaf (about 60 MB). Then set the reader's Image source to assets/mushaf/
cd "$(dirname "$0")/.." && mkdir -p src/assets/mushaf
for i in $(seq 1 604); do n=$(printf '%03d.png' $i); [ -f src/assets/mushaf/$n ] || curl -fsSL -o src/assets/mushaf/$n https://raw.githubusercontent.com/GovarJabbar/Quran-PNG/master/$n || { echo "failed at $n"; exit 1; }; done
echo done
